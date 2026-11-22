// The authoritative, pure, deterministic game state machine.
// reduce(state, action) never mutates its input and never reads the clock or
// Math.random: time comes in on the action, randomness from state.rngSeed.

import { createRng, type Rng } from "./rng";
import { dealRoles, MAX_PLAYERS, MIN_PLAYERS, ROLE_INFO } from "./roles";
import { narrate } from "./narrator";
import {
  SKIP,
  type Action,
  type Channel,
  type GameState,
  type NarrationEvent,
  type NightStep,
  type Phase,
  type Player,
  type ReduceResult,
  type Settings,
  type VoteChoice,
} from "./types";

export const DEFAULT_SETTINGS: Settings = {
  discussionSeconds: 180,
  nightStepSeconds: 30,
  voteSeconds: 60,
  roleRevealSeconds: 15,
  morningSeconds: 9,
  voteResultSeconds: 9,
  hostGraceSeconds: 20,
  lobbyGraceSeconds: 45,
};

export const NIGHT_STEPS: NightStep[] = ["mafia", "doctor", "detective"];
export const MAX_CHAT_MESSAGES = 200;
export const MAX_CHAT_LENGTH = 300;
export const MAX_NAME_LENGTH = 20;

const HEX = /^#[0-9a-fA-F]{6}$/;
const BOT_NAMES = [
  "Vinnie", "Rosa", "Sal", "Greta", "Luca", "Mabel", "Tony", "Iris",
  "Frankie", "Opal", "Benny", "Dolores", "Gus", "Hazel", "Nico", "Pearl",
];
const BOT_BODY = ["#E0A458", "#7FB685", "#D1495B", "#6C8EBF", "#C38D9E", "#F2C14E", "#4F9D9A", "#B07BAC"];
const BOT_SKIN = ["#F5D0B5", "#E8B48F", "#C68863", "#8D5A3B", "#5C3A24"];

export function createGame(code: string, seed: number, now: number, settings: Partial<Settings> = {}): GameState {
  const rng = createRng(seed);
  return {
    code,
    rngSeed: rng.seed(),
    phase: "lobby",
    round: 0,
    phaseStartedAt: now,
    phaseEndsAt: null,
    hostId: null,
    players: [],
    night: null,
    lastDoctorTarget: null,
    detectiveResults: [],
    morning: null,
    votes: {},
    voteReport: null,
    winner: null,
    narration: { seq: 0, event: "lobby", text: narrate("lobby", rng) },
    chat: [],
    nextChatId: 1,
    settings: { ...DEFAULT_SETTINGS, ...settings },
  };
}

// ---------- queries (also used by the view filter and bots) ----------

export const findPlayer = (s: GameState, id: string | null | undefined) =>
  id ? s.players.find((p) => p.id === id) : undefined;

export const living = (s: GameState) => s.players.filter((p) => p.alive);

export const livingWithRole = (s: GameState, role: Player["role"]) =>
  s.players.filter((p) => p.alive && p.role === role);

export function checkWinner(s: GameState): "village" | "mafia" | null {
  const alive = living(s);
  const mafia = alive.filter((p) => p.role === "mafia").length;
  const others = alive.length - mafia;
  if (mafia === 0) return "village";
  if (mafia >= others) return "mafia";
  return null;
}

const PUBLIC_CHAT_PHASES: Phase[] = ["lobby", "morning", "day", "vote", "voteResult", "ended"];

export function canWriteChannel(s: GameState, p: Player | undefined, channel: Channel): boolean {
  if (!p) return false;
  const inGame = s.phase !== "lobby" && s.phase !== "ended";
  switch (channel) {
    case "public":
      if (!PUBLIC_CHAT_PHASES.includes(s.phase)) return false;
      return !inGame || p.alive;
    case "mafia":
      return inGame && p.alive && p.role === "mafia" && s.phase === "night";
    case "ghost":
      return inGame && !p.alive;
  }
}

export function canReadChannel(s: GameState, p: Player | undefined, channel: Channel): boolean {
  switch (channel) {
    case "public":
      return true;
    case "mafia":
      return !!p && p.role === "mafia" && s.phase !== "lobby";
    case "ghost":
      return !!p && !p.alive && s.phase !== "lobby";
  }
}

/** Players the given actor may target in the current night step. */
export function validNightTargets(s: GameState, actorId: string): string[] {
  const actor = findPlayer(s, actorId);
  if (s.phase !== "night" || !s.night || !actor || !actor.alive || actor.role !== s.night.step) return [];
  const alive = living(s);
  switch (s.night.step) {
    case "mafia":
      return alive.filter((p) => p.role !== "mafia").map((p) => p.id);
    case "doctor":
      return alive.filter((p) => p.id !== s.lastDoctorTarget).map((p) => p.id);
    case "detective":
      return alive.filter((p) => p.id !== actor.id).map((p) => p.id);
  }
}

/** Has this player already acted in the current night step? */
export function hasActedTonight(s: GameState, actorId: string): boolean {
  if (!s.night) return false;
  switch (s.night.step) {
    case "mafia":
      return actorId in s.night.mafiaVotes;
    case "doctor":
      return s.night.doctorTarget !== null;
    case "detective":
      return s.night.detectiveTarget !== null;
  }
}

// ---------- reducer ----------

export function reduce(state: GameState, action: Action): ReduceResult {
  const s: GameState = structuredClone(state);
  const rng = createRng(s.rngSeed);
  const error = apply(s, action, rng);
  if (error) return { state, error };
  s.rngSeed = rng.seed();
  return { state: s };
}

function apply(s: GameState, a: Action, rng: Rng): string | undefined {
  switch (a.type) {
    case "JOIN":
      return join(s, a);
    case "CONNECT": {
      const p = findPlayer(s, a.playerId);
      if (!p) return "Unknown player.";
      p.connected = true;
      p.disconnectedAt = null;
      p.left = false;
      if (!s.hostId) s.hostId = p.id;
      return;
    }
    case "DISCONNECT": {
      const p = findPlayer(s, a.playerId);
      if (!p) return;
      p.connected = false;
      p.disconnectedAt = a.now;
      return;
    }
    case "LEAVE":
      return leave(s, a.playerId);
    case "ADD_BOTS":
      return addBots(s, a.playerId, a.count, rng);
    case "START":
      return start(s, a.playerId, a.now, rng);
    case "READY": {
      if (s.phase !== "roleReveal") return "Not now.";
      const p = findPlayer(s, a.playerId);
      if (!p) return "Unknown player.";
      p.ready = true;
      if (s.players.every((q) => q.ready || !q.connected || q.left)) startNight(s, a.now, rng);
      return;
    }
    case "NIGHT_ACTION":
      return nightAction(s, a.playerId, a.targetId, a.now, rng);
    case "VOTE":
      return vote(s, a.playerId, a.choice, a.now, rng);
    case "SKIP_DISCUSSION":
      if (s.phase !== "day") return "Not now.";
      if (s.hostId !== a.playerId) return "Only the host can skip the discussion.";
      startVote(s, a.now, rng);
      return;
    case "PLAY_AGAIN":
      return playAgain(s, a.playerId, a.now, rng);
    case "CHAT":
      return chat(s, a.playerId, a.channel, a.text, a.now);
    case "TICK":
      tick(s, a.now, rng);
      return;
  }
}

function join(s: GameState, a: Extract<Action, { type: "JOIN" }>): string | undefined {
  const name = a.name.replace(/\s+/g, " ").trim().slice(0, MAX_NAME_LENGTH) || "Guest";
  const bodyColor = HEX.test(a.bodyColor) ? a.bodyColor : "#E0A458";
  const skinColor = HEX.test(a.skinColor) ? a.skinColor : "#E8B48F";
  const existing = findPlayer(s, a.playerId);
  if (existing) {
    existing.connected = true;
    existing.disconnectedAt = null;
    existing.left = false;
    if (s.phase === "lobby") Object.assign(existing, { name, bodyColor, skinColor });
    if (!s.hostId) s.hostId = existing.id;
    return;
  }
  if (s.phase !== "lobby") return "A game is already in progress at this table. Try again when it ends.";
  if (s.players.length >= MAX_PLAYERS) return `This table is full (${MAX_PLAYERS} seats).`;
  s.players.push({
    id: a.playerId,
    name,
    bodyColor,
    skinColor,
    seat: freeSeat(s),
    isBot: false,
    connected: true,
    disconnectedAt: null,
    left: false,
    role: null,
    alive: true,
    roleRevealed: false,
    ready: false,
  });
  if (!s.hostId) s.hostId = a.playerId;
  return;
}

function freeSeat(s: GameState): number {
  const taken = new Set(s.players.map((p) => p.seat));
  let seat = 0;
  while (taken.has(seat)) seat++;
  return seat;
}

function leave(s: GameState, playerId: string): string | undefined {
  const p = findPlayer(s, playerId);
  if (!p) return;
  if (s.phase === "lobby") {
    s.players = s.players.filter((q) => q.id !== playerId);
  } else {
    p.left = true;
    p.connected = false;
  }
  if (s.hostId === playerId) reassignHost(s);
  return;
}

/** Next connected human, going round the table from the old host's seat. */
function reassignHost(s: GameState) {
  const old = findPlayer(s, s.hostId);
  const candidates = s.players
    .filter((p) => !p.isBot && p.connected && !p.left && p.id !== s.hostId)
    .sort((a, b) => a.seat - b.seat);
  if (candidates.length === 0) {
    s.hostId = old && !old.left ? old.id : null;
    return;
  }
  const from = old?.seat ?? -1;
  s.hostId = (candidates.find((p) => p.seat > from) ?? candidates[0]).id;
}

function addBots(s: GameState, playerId: string, count: number, rng: Rng): string | undefined {
  if (s.phase !== "lobby") return "Bots can only join in the lobby.";
  if (s.hostId !== playerId) return "Only the host can add bots.";
  const n = Math.max(0, Math.min(Math.floor(count), MAX_PLAYERS - s.players.length));
  if (n === 0) return "The table is full.";
  const used = new Set(s.players.map((p) => p.name));
  for (let i = 0; i < n; i++) {
    const base = BOT_NAMES.find((nm) => !used.has(`${nm} 🤖`)) ?? `Bot${s.players.length}`;
    const name = `${base} 🤖`;
    used.add(name);
    let id = `bot-${base.toLowerCase()}`;
    while (findPlayer(s, id)) id += "x";
    s.players.push({
      id,
      name,
      bodyColor: rng.pick(BOT_BODY),
      skinColor: rng.pick(BOT_SKIN),
      seat: freeSeat(s),
      isBot: true,
      connected: true,
      disconnectedAt: null,
      left: false,
      role: null,
      alive: true,
      roleRevealed: false,
      ready: false,
    });
  }
  return;
}

function start(s: GameState, playerId: string, now: number, rng: Rng): string | undefined {
  if (s.phase !== "lobby") return "The game has already started.";
  if (s.hostId !== playerId) return "Only the host can start the game.";
  if (s.players.length < MIN_PLAYERS) return `The table needs ${MIN_PLAYERS} or more players.`;
  const roles = dealRoles(s.players.map((p) => p.id), rng);
  for (const p of s.players) {
    p.role = roles[p.id];
    p.alive = true;
    p.roleRevealed = false;
    p.ready = false;
  }
  s.round = 0;
  s.night = null;
  s.lastDoctorTarget = null;
  s.detectiveResults = [];
  s.morning = null;
  s.votes = {};
  s.voteReport = null;
  s.winner = null;
  s.chat = s.chat.filter((m) => m.channel === "public");
  setPhase(s, "roleReveal", now, s.settings.roleRevealSeconds);
  say(s, rng, "roleReveal");
  return;
}

function setPhase(s: GameState, phase: Phase, now: number, seconds: number | null) {
  s.phase = phase;
  s.phaseStartedAt = now;
  s.phaseEndsAt = seconds === null ? null : now + seconds * 1000;
}

function say(s: GameState, rng: Rng, event: NarrationEvent, vars?: Record<string, string | number>, prefix = "") {
  const text = narrate(event, rng, vars);
  s.narration = { seq: s.narration.seq + 1, event, text: prefix ? `${prefix} ${text}` : text };
}

// ---------- night ----------

function stepHasActor(s: GameState, step: NightStep) {
  return livingWithRole(s, step).length > 0;
}

function startNight(s: GameState, now: number, rng: Rng) {
  s.round += 1;
  s.votes = {};
  s.night = { step: "mafia", mafiaVotes: {}, doctorTarget: null, detectiveTarget: null };
  const intro = narrate("nightFalls", rng);
  const first = NIGHT_STEPS.find((st) => stepHasActor(s, st));
  if (!first) return resolveNight(s, now, rng);
  enterStep(s, first, now, rng, intro);
}

const WAKE: Record<NightStep, NarrationEvent> = {
  mafia: "mafiaWake",
  doctor: "doctorWake",
  detective: "detectiveWake",
};

function enterStep(s: GameState, step: NightStep, now: number, rng: Rng, prefix = "") {
  s.night!.step = step;
  setPhase(s, "night", now, s.settings.nightStepSeconds);
  say(s, rng, WAKE[step], undefined, prefix);
}

function advanceNight(s: GameState, now: number, rng: Rng) {
  const idx = NIGHT_STEPS.indexOf(s.night!.step);
  const next = NIGHT_STEPS.slice(idx + 1).find((st) => stepHasActor(s, st));
  if (next) enterStep(s, next, now, rng);
  else resolveNight(s, now, rng);
}

/** Plurality of the mafia's votes; ties broken at random. */
export function mafiaTarget(votes: Record<string, string>, rng: Rng): string | null {
  const counts = new Map<string, number>();
  for (const t of Object.values(votes)) counts.set(t, (counts.get(t) ?? 0) + 1);
  if (counts.size === 0) return null;
  const max = Math.max(...counts.values());
  const top = [...counts.entries()].filter(([, c]) => c === max).map(([id]) => id).sort();
  return top.length === 1 ? top[0] : rng.pick(top);
}

function nightAction(s: GameState, playerId: string, targetId: string, now: number, rng: Rng): string | undefined {
  if (s.phase !== "night" || !s.night) return "It isn't night.";
  const actor = findPlayer(s, playerId);
  if (!actor || !actor.alive) return "Ghosts can't act.";
  if (actor.role !== s.night.step) return "It isn't your turn.";
  if (!validNightTargets(s, playerId).includes(targetId)) {
    if (s.night.step === "doctor" && targetId === s.lastDoctorTarget)
      return "You protected that player last night. Pick someone else.";
    return "You can't pick that player.";
  }
  switch (s.night.step) {
    case "mafia": {
      s.night.mafiaVotes[playerId] = targetId;
      const mafia = livingWithRole(s, "mafia");
      if (mafia.every((m) => m.id in s.night!.mafiaVotes)) advanceNight(s, now, rng);
      return;
    }
    case "doctor":
      if (s.night.doctorTarget) return "You've already chosen tonight.";
      s.night.doctorTarget = targetId;
      advanceNight(s, now, rng);
      return;
    case "detective": {
      if (s.night.detectiveTarget) return "You've already investigated tonight.";
      s.night.detectiveTarget = targetId;
      const target = findPlayer(s, targetId)!;
      s.detectiveResults.push({ round: s.round, targetId, isMafia: target.role === "mafia" });
      advanceNight(s, now, rng);
      return;
    }
  }
}

function resolveNight(s: GameState, now: number, rng: Rng) {
  const night = s.night!;
  // Only votes from mafia who are still alive count.
  const votes = Object.fromEntries(
    Object.entries(night.mafiaVotes).filter(([id]) => findPlayer(s, id)?.alive),
  );
  const target = mafiaTarget(votes, rng);
  const saved = !!target && target === night.doctorTarget;
  const killedId = target && !saved ? target : null;
  s.lastDoctorTarget = night.doctorTarget;
  s.morning = { round: s.round, killedId, saved };
  s.night = null;
  setPhase(s, "morning", now, s.settings.morningSeconds);
  if (killedId) {
    const victim = findPlayer(s, killedId)!;
    victim.alive = false;
    victim.roleRevealed = true;
    say(s, rng, "morningDeath", { name: victim.name, role: ROLE_INFO[victim.role!].title });
  } else if (saved) {
    say(s, rng, "morningSaved");
  } else {
    say(s, rng, "morningQuiet");
  }
}

// ---------- day & vote ----------

function startDay(s: GameState, now: number, rng: Rng) {
  setPhase(s, "day", now, s.settings.discussionSeconds);
  say(s, rng, "dayStart");
}

function startVote(s: GameState, now: number, rng: Rng) {
  s.votes = {};
  setPhase(s, "vote", now, s.settings.voteSeconds);
  say(s, rng, "voteStart");
}

function vote(s: GameState, playerId: string, choice: VoteChoice, now: number, rng: Rng): string | undefined {
  if (s.phase !== "vote") return "Voting isn't open.";
  const voter = findPlayer(s, playerId);
  if (!voter || !voter.alive) return "Ghosts can't vote.";
  if (choice !== SKIP) {
    const target = findPlayer(s, choice);
    if (!target || !target.alive) return "You can only vote for a living player.";
    if (target.id === voter.id) return "You can't vote for yourself.";
  }
  s.votes[playerId] = choice;
  if (living(s).every((p) => p.id in s.votes)) resolveVote(s, now, rng);
  return;
}

/** Most votes is out. A tie at the top, or skip having the most (or tying), means nobody. */
export function tallyVotes(ballots: Record<string, VoteChoice>): { tally: Record<string, number>; eliminatedId: string | null } {
  const tally: Record<string, number> = {};
  for (const c of Object.values(ballots)) tally[c] = (tally[c] ?? 0) + 1;
  const skip = tally[SKIP] ?? 0;
  const players = Object.entries(tally).filter(([id]) => id !== SKIP);
  if (players.length === 0) return { tally, eliminatedId: null };
  const max = Math.max(...players.map(([, c]) => c));
  const top = players.filter(([, c]) => c === max);
  if (top.length > 1 || skip >= max) return { tally, eliminatedId: null };
  return { tally, eliminatedId: top[0][0] };
}

function resolveVote(s: GameState, now: number, rng: Rng) {
  const ballots = Object.fromEntries(Object.entries(s.votes).filter(([id]) => findPlayer(s, id)?.alive));
  const { tally, eliminatedId } = tallyVotes(ballots);
  s.voteReport = { round: s.round, tally, ballots, eliminatedId };
  s.votes = {};
  setPhase(s, "voteResult", now, s.settings.voteResultSeconds);
  if (eliminatedId) {
    const p = findPlayer(s, eliminatedId)!;
    p.alive = false;
    p.roleRevealed = true;
    say(s, rng, "voteElimination", { name: p.name, role: ROLE_INFO[p.role!].title, n: tally[eliminatedId] });
  } else {
    say(s, rng, "voteNoElimination");
  }
}

// ---------- end ----------

function endIfWon(s: GameState, now: number, rng: Rng): boolean {
  const winner = checkWinner(s);
  if (!winner) return false;
  s.winner = winner;
  for (const p of s.players) p.roleRevealed = true;
  setPhase(s, "ended", now, null);
  say(s, rng, winner === "village" ? "villageWins" : "mafiaWins");
  return true;
}

function playAgain(s: GameState, playerId: string, now: number, rng: Rng): string | undefined {
  if (s.phase !== "ended") return "The game isn't over yet.";
  if (s.hostId !== playerId) return "Only the host can start a new game.";
  s.players = s.players.filter((p) => p.isBot || (!p.left && p.connected));
  s.players.forEach((p) => {
    p.role = null;
    p.alive = true;
    p.roleRevealed = false;
    p.ready = false;
  });
  s.round = 0;
  s.winner = null;
  s.morning = null;
  s.voteReport = null;
  s.detectiveResults = [];
  s.lastDoctorTarget = null;
  s.chat = s.chat.filter((m) => m.channel === "public");
  setPhase(s, "lobby", now, null);
  say(s, rng, "lobby");
  return;
}

// ---------- chat ----------

function chat(s: GameState, playerId: string, channel: Channel, text: string, now: number): string | undefined {
  const p = findPlayer(s, playerId);
  if (!canWriteChannel(s, p, channel)) return "You can't post in that chat right now.";
  const clean = text.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, MAX_CHAT_LENGTH);
  if (!clean) return;
  s.chat.push({ id: s.nextChatId++, channel, fromId: p!.id, fromName: p!.name, text: clean, at: now });
  if (s.chat.length > MAX_CHAT_MESSAGES) s.chat = s.chat.slice(-MAX_CHAT_MESSAGES);
  return;
}

// ---------- clock ----------

function tick(s: GameState, now: number, rng: Rng) {
  // Host who has been gone too long hands over to the next player.
  const host = findPlayer(s, s.hostId);
  if (
    !host ||
    host.left ||
    (!host.connected && host.disconnectedAt !== null && now - host.disconnectedAt >= s.settings.hostGraceSeconds * 1000)
  ) {
    reassignHost(s);
  }

  if (s.phase === "lobby") {
    const before = s.players.length;
    s.players = s.players.filter(
      (p) =>
        p.isBot ||
        p.connected ||
        p.disconnectedAt === null ||
        now - p.disconnectedAt < s.settings.lobbyGraceSeconds * 1000,
    );
    if (s.players.length !== before && !findPlayer(s, s.hostId)) reassignHost(s);
    return;
  }

  if (s.phaseEndsAt === null || now < s.phaseEndsAt) return;

  switch (s.phase) {
    case "roleReveal":
      startNight(s, now, rng);
      return;
    case "night":
      advanceNight(s, now, rng);
      return;
    case "morning":
      if (!endIfWon(s, now, rng)) startDay(s, now, rng);
      return;
    case "day":
      startVote(s, now, rng);
      return;
    case "vote":
      resolveVote(s, now, rng);
      return;
    case "voteResult":
      if (!endIfWon(s, now, rng)) startNight(s, now, rng);
      return;
  }
}
