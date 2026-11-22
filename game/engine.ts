// The authoritative, pure, deterministic game state machine.
// reduce(state, action) never mutates its input and never reads the clock or
// Math.random: time comes in on the action, randomness from state.rngSeed.

import { createRng, type Rng } from "./rng";
import { dealRoles, MAX_PLAYERS, MIN_PLAYERS, ROLE_INFO, validateRules } from "./roles";
import { DEFAULT_RULES, sanitizeRules } from "./rules";
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
  type Role,
  type Settings,
  type VoteChoice,
  type Winner,
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
/** With a Judge in the game, the verdict waits this long before it takes effect. */
export const JUDGE_WINDOW_SECONDS = 12;

/** Phases in which the table is awake and a Terrorist may act. */
const AWAKE_POWER_PHASES: readonly Phase[] = ["morning", "day", "vote"];
/** Powers an Heir can inherit, and which of them are spent after one use. */
const HEIR_POWERS: readonly Role[] = ["doctor", "detective", "terrorist", "mayor", "judge", "lawyer"];
const ONCE_A_GAME: readonly Role[] = ["terrorist", "judge", "lawyer"];

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
    rules: structuredClone(DEFAULT_RULES),
    immune: null,
    haunts: [],
    notes: [],
    nextNoteId: 1,
  };
}

/** Fill in fields added after a table was saved, so old saved games still load. */
export function migrateState(state: GameState): GameState {
  const s = structuredClone(state);
  s.rules = sanitizeRules(DEFAULT_RULES, s.rules);
  s.immune ??= null;
  s.haunts ??= [];
  s.notes ??= [];
  s.nextNoteId ??= 1;
  for (const p of s.players) {
    p.lover ??= null;
    p.used ??= false;
    p.defected ??= false;
    p.hauntUsed ??= false;
  }
  if (s.night) s.night.watchers ??= [];
  if (s.morning) s.morning.alsoDied ??= [];
  if (s.voteReport) {
    s.voteReport.pending ??= false;
    s.voteReport.overturned ??= false;
    s.voteReport.immuneId ??= null;
  }
  return s;
}

// ---------- queries (also used by the view filter and bots) ----------

export const findPlayer = (s: GameState, id: string | null | undefined) =>
  id ? s.players.find((p) => p.id === id) : undefined;

export const living = (s: GameState) => s.players.filter((p) => p.alive);

export const livingWithRole = (s: GameState, role: Player["role"]) =>
  s.players.filter((p) => p.alive && p.role === role);

/** The Mafia team: Mafia and the Godfather. (A turned Defector becomes plain Mafia.) */
export const isMafiaTeam = (role: Role | null | undefined) => role === "mafia" || role === "godfather";

/** Which night step a role acts in, if any. */
export function nightStepOf(role: Role | null | undefined): NightStep | null {
  if (isMafiaTeam(role)) return "mafia";
  if (role === "doctor") return "doctor";
  if (role === "detective") return "detective";
  return null;
}

/** Village wins when no Mafia are left; Mafia win when they equal the rest. (The Jester wins by being voted out.) */
export function checkWinner(s: GameState): "village" | "mafia" | null {
  const alive = living(s);
  const mafia = alive.filter((p) => isMafiaTeam(p.role)).length;
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
      return inGame && p.alive && isMafiaTeam(p.role) && s.phase === "night";
    case "ghost":
      return inGame && !p.alive;
  }
}

export function canReadChannel(s: GameState, p: Player | undefined, channel: Channel): boolean {
  switch (channel) {
    case "public":
      return true;
    case "mafia":
      return !!p && isMafiaTeam(p.role) && s.phase !== "lobby";
    case "ghost":
      return !!p && !p.alive && s.phase !== "lobby";
  }
}

/** Players the given actor may target in the current night step. */
export function validNightTargets(s: GameState, actorId: string): string[] {
  const actor = findPlayer(s, actorId);
  if (s.phase !== "night" || !s.night || !actor || !actor.alive || nightStepOf(actor.role) !== s.night.step) return [];
  const alive = living(s);
  switch (s.night.step) {
    case "mafia":
      return alive.filter((p) => !isMafiaTeam(p.role)).map((p) => p.id);
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

/** The player shielded from today's vote by the Lawyer, if any. */
export const immuneToday = (s: GameState): string | null => (s.immune && s.immune.round === s.round ? s.immune.targetId : null);

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
    case "SET_RULES":
      return setRules(s, a.playerId, a.rules);
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
    case "NIGHT_WATCH":
      return nightWatch(s, a.playerId);
    case "GHOST_HAUNT":
      return ghostHaunt(s, a.playerId, a.targetId, a.now, rng);
    case "TERRORIST_BOMB":
      return terroristBomb(s, a.playerId, a.targetId, a.now, rng);
    case "JUDGE_OVERTURN":
      return judgeOverturn(s, a.playerId, a.now, rng);
    case "LAWYER_SHIELD":
      return lawyerShield(s, a.playerId, a.targetId, rng);
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

/** The per-game state every player starts with. */
const freshPlayerState = () => ({
  role: null,
  alive: true,
  roleRevealed: false,
  ready: false,
  lover: null,
  used: false,
  defected: false,
  hauntUsed: false,
});

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
    ...freshPlayerState(),
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
      ...freshPlayerState(),
    });
  }
  return;
}

function setRules(s: GameState, playerId: string, patch: unknown): string | undefined {
  if (s.phase !== "lobby") return "The rules can only be changed before the game starts.";
  if (s.hostId !== playerId) return "Only the host can change the house rules.";
  s.rules = sanitizeRules(s.rules, patch);
  s.settings.discussionSeconds = s.rules.discussionSeconds;
  return;
}

function start(s: GameState, playerId: string, now: number, rng: Rng): string | undefined {
  if (s.phase !== "lobby") return "The game has already started.";
  if (s.hostId !== playerId) return "Only the host can start the game.";
  if (s.players.length < MIN_PLAYERS) return `The table needs ${MIN_PLAYERS} or more players.`;
  const problem = validateRules(s.players.length, s.rules);
  if (problem) return problem;
  const roles = dealRoles(s.players.map((p) => p.id), rng, s.rules);
  for (const p of s.players) {
    Object.assign(p, freshPlayerState());
    p.role = roles[p.id];
    // The Mayor is public from the first moment.
    p.roleRevealed = p.role === "mayor";
  }
  s.round = 0;
  s.night = null;
  s.lastDoctorTarget = null;
  s.detectiveResults = [];
  s.morning = null;
  s.votes = {};
  s.voteReport = null;
  s.winner = null;
  s.immune = null;
  s.haunts = [];
  s.notes = [];
  s.nextNoteId = 1;
  s.chat = s.chat.filter((m) => m.channel === "public");
  if (s.rules.lovers) assignLovers(s, rng);
  setPhase(s, "roleReveal", now, s.settings.roleRevealSeconds);
  say(s, rng, "roleReveal");
  return;
}

/** Two townspeople (never the Mafia or the Jester) are secretly in love. */
function assignLovers(s: GameState, rng: Rng) {
  const eligible = s.players.filter((p) => !isMafiaTeam(p.role) && p.role !== "jester");
  if (eligible.length < 2) return;
  const [a, b] = rng.shuffle(eligible);
  a.lover = b.id;
  b.lover = a.id;
  addNote(s, a.id, `You and ${b.name} are secretly in love. If one of you dies, so does the other.`);
  addNote(s, b.id, `You and ${a.name} are secretly in love. If one of you dies, so does the other.`);
}

function addNote(s: GameState, playerId: string, text: string) {
  s.notes.push({ id: s.nextNoteId++, playerId, round: s.round, text });
}

function setPhase(s: GameState, phase: Phase, now: number, seconds: number | null) {
  s.phase = phase;
  s.phaseStartedAt = now;
  s.phaseEndsAt = seconds === null ? null : now + seconds * 1000;
}

function say(
  s: GameState,
  rng: Rng,
  event: NarrationEvent,
  vars?: Record<string, string | number>,
  prefix = "",
  suffix = "",
) {
  const text = [prefix, narrate(event, rng, vars), suffix].filter(Boolean).join(" ");
  s.narration = { seq: s.narration.seq + 1, event, text };
}

/** "…couldn't bear the loss" lines for everyone who died of a broken heart. */
function loverSuffix(s: GameState, rng: Rng, alsoDied: string[]): string {
  return alsoDied.map((id) => narrate("loversFall", rng, { partner: findPlayer(s, id)?.name ?? "Someone" })).join(" ");
}

// ---------- deaths ----------

function kill(s: GameState, p: Player) {
  p.alive = false;
  if (s.rules.revealRoles) p.roleRevealed = true;
}

/**
 * Everything that follows a death, in order: a Lover's partner dies too, an Heir
 * inherits a lost power, and the Defector joins the Mafia if none are left.
 * Returns the ids that died along the way (Lovers), not the ones passed in.
 */
function settleDeaths(s: GameState, firstDead: string[]): string[] {
  const alsoDied: string[] = [];
  const queue = [...firstDead];
  while (queue.length) {
    const dead = findPlayer(s, queue.shift())!;
    if (dead.lover) {
      const partner = findPlayer(s, dead.lover);
      if (partner?.alive) {
        kill(s, partner);
        alsoDied.push(partner.id);
        queue.push(partner.id);
      }
    }
    inherit(s, dead);
  }
  turnDefectors(s);
  return alsoDied;
}

function inherit(s: GameState, dead: Player) {
  if (!dead.role || !HEIR_POWERS.includes(dead.role)) return;
  if (ONCE_A_GAME.includes(dead.role) && dead.used) return;
  const heir = living(s).find((p) => p.role === "heir");
  if (!heir) return;
  heir.role = dead.role;
  heir.used = false;
  if (heir.role === "mayor") heir.roleRevealed = true;
  addNote(s, heir.id, `${dead.name} is gone, and you inherited their power. You are now the ${ROLE_INFO[dead.role].title}.`);
}

function turnDefectors(s: GameState) {
  if (living(s).some((p) => isMafiaTeam(p.role))) return;
  for (const d of living(s).filter((p) => p.role === "defector")) {
    d.role = "mafia";
    d.defected = true;
    addNote(s, d.id, "Every Mafia member is gone. You've joined the Mafia, and you're all that's left of it.");
  }
}

// ---------- night ----------

function stepHasActor(s: GameState, step: NightStep) {
  return living(s).some((p) => nightStepOf(p.role) === step);
}

function startNight(s: GameState, now: number, rng: Rng) {
  s.round += 1;
  s.votes = {};
  s.night = { step: "mafia", mafiaVotes: {}, doctorTarget: null, detectiveTarget: null, watchers: [] };
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
  if (nightStepOf(actor.role) !== s.night.step) return "It isn't your turn.";
  if (!validNightTargets(s, playerId).includes(targetId)) {
    if (s.night.step === "doctor" && targetId === s.lastDoctorTarget)
      return "You protected that player last night. Pick someone else.";
    return "You can't pick that player.";
  }
  switch (s.night.step) {
    case "mafia": {
      s.night.mafiaVotes[playerId] = targetId;
      const mafia = living(s).filter((p) => isMafiaTeam(p.role));
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
      // The Godfather (and anyone who isn't plain Mafia) reads as innocent.
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
  s.night = null;
  setPhase(s, "morning", now, s.settings.morningSeconds);
  let alsoDied: string[] = [];
  const culprits = Object.keys(votes);
  if (killedId) {
    const victim = findPlayer(s, killedId)!;
    kill(s, victim);
    alsoDied = settleDeaths(s, [killedId]);
    say(
      s,
      rng,
      s.rules.revealRoles ? "morningDeath" : "morningDeathHidden",
      { name: victim.name, role: ROLE_INFO[victim.role!].title },
      "",
      loverSuffix(s, rng, alsoDied),
    );
  } else if (saved) {
    say(s, rng, "morningSaved");
  } else {
    say(s, rng, "morningQuiet");
  }
  s.morning = { round: s.round, killedId, saved, alsoDied };
  // Whoever kept watch hears something, if they're still around to hear it.
  for (const id of night.watchers) {
    const w = findPlayer(s, id);
    if (w?.alive) addNote(s, id, watchClue(s, rng, w, culprits));
  }
}

/** Three names, one of whom really was creeping around. Only the watcher ever sees it. */
function watchClue(s: GameState, rng: Rng, watcher: Player, culpritIds: string[]): string {
  const culprits = culpritIds.filter((id) => findPlayer(s, id)?.alive).sort();
  if (culprits.length === 0) return "You kept watch through the night, but heard nothing at all.";
  const culprit = rng.pick(culprits);
  const decoys = rng
    .shuffle(living(s).filter((p) => p.id !== watcher.id && p.id !== culprit))
    .slice(0, 2)
    .map((p) => p.id);
  const names = rng.shuffle([culprit, ...decoys]).map((id) => findPlayer(s, id)!.name);
  return `You kept watch and heard a noise in the dark. Someone was creeping around, and it was one of: ${names.join(", ")}.`;
}

function nightWatch(s: GameState, playerId: string): string | undefined {
  if (s.phase !== "night" || !s.night) return "It isn't night.";
  if (!s.rules.nightWatch) return "Night watch isn't part of these house rules.";
  const me = findPlayer(s, playerId);
  if (!me || !me.alive) return "Ghosts can't keep watch.";
  if (isMafiaTeam(me.role)) return "The Mafia are already awake.";
  if (s.night.watchers.includes(playerId)) return "You're already keeping watch.";
  s.night.watchers.push(playerId);
  return;
}

function ghostHaunt(s: GameState, playerId: string, targetId: string, now: number, rng: Rng): string | undefined {
  if (!s.rules.ghostHaunts) return "Ghost haunts aren't part of these house rules.";
  if (s.phase !== "day" && s.phase !== "vote") return "Ghosts can only haunt during the day.";
  const me = findPlayer(s, playerId);
  if (!me || me.alive) return "Only ghosts can haunt.";
  if (me.hauntUsed) return "You've already haunted someone.";
  const target = findPlayer(s, targetId);
  if (!target || !target.alive) return "Pick a living player.";
  me.hauntUsed = true;
  s.haunts.push({ round: s.round, targetId });
  // Anonymous: the town learns that a ghost pointed, not which one.
  s.chat.push({ id: s.nextChatId++, channel: "public", fromId: "system", fromName: "👻", text: `A ghost points at ${target.name}.`, at: now });
  if (s.chat.length > MAX_CHAT_MESSAGES) s.chat = s.chat.slice(-MAX_CHAT_MESSAGES);
  say(s, rng, "ghostPoints", { name: target.name });
  return;
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
    if (target.id === immuneToday(s)) return "That player is shielded from today's vote.";
  }
  s.votes[playerId] = choice;
  if (living(s).every((p) => p.id in s.votes)) resolveVote(s, now, rng);
  return;
}

/**
 * Most votes is out. A tie at the top, or skip having the most (or tying), means nobody.
 * `weight` lets a voter count for more than one (the Mayor).
 */
export function tallyVotes(
  ballots: Record<string, VoteChoice>,
  weight: (voterId: string) => number = () => 1,
): { tally: Record<string, number>; eliminatedId: string | null } {
  const tally: Record<string, number> = {};
  for (const [voter, c] of Object.entries(ballots)) tally[c] = (tally[c] ?? 0) + weight(voter);
  const skip = tally[SKIP] ?? 0;
  const players = Object.entries(tally).filter(([id]) => id !== SKIP);
  if (players.length === 0) return { tally, eliminatedId: null };
  const max = Math.max(...players.map(([, c]) => c));
  const top = players.filter(([, c]) => c === max);
  if (top.length > 1 || skip >= max) return { tally, eliminatedId: null };
  return { tally, eliminatedId: top[0][0] };
}

function resolveVote(s: GameState, now: number, rng: Rng) {
  const immuneId = immuneToday(s);
  const ballots = Object.fromEntries(Object.entries(s.votes).filter(([id]) => findPlayer(s, id)?.alive));
  // Votes for the dead or for a shielded player are void.
  const valid = Object.fromEntries(
    Object.entries(ballots).filter(([, c]) => c === SKIP || (findPlayer(s, c)?.alive && c !== immuneId)),
  );
  const { tally, eliminatedId } = tallyVotes(valid, (id) => (findPlayer(s, id)?.role === "mayor" ? 2 : 1));
  // With a Judge in the game the verdict waits, so the Judge may step in. Everyone can see
  // the rules, so waiting doesn't reveal whether a Judge is alive or has already acted.
  const pending = !!eliminatedId && s.rules.roles.judge;
  s.voteReport = { round: s.round, tally, ballots, eliminatedId, pending, overturned: false, immuneId };
  s.votes = {};
  if (!eliminatedId) {
    setPhase(s, "voteResult", now, s.settings.voteResultSeconds);
    say(s, rng, "voteNoElimination");
  } else if (pending) {
    setPhase(s, "voteResult", now, JUDGE_WINDOW_SECONDS);
    say(s, rng, "voteProposed", { name: findPlayer(s, eliminatedId)!.name });
  } else {
    applyVerdict(s, now, rng);
  }
}

/** The town's choice takes effect. */
function applyVerdict(s: GameState, now: number, rng: Rng) {
  const report = s.voteReport!;
  report.pending = false;
  const p = findPlayer(s, report.eliminatedId)!;
  kill(s, p);
  const alsoDied = settleDeaths(s, [p.id]);
  // The Jester wins the moment the town votes them out.
  if (p.role === "jester") return endGame(s, "jester", now, rng, { name: p.name });
  setPhase(s, "voteResult", now, s.settings.voteResultSeconds);
  say(
    s,
    rng,
    s.rules.revealRoles ? "voteElimination" : "voteEliminationHidden",
    { name: p.name, role: ROLE_INFO[p.role!].title, n: report.tally[p.id] },
    "",
    loverSuffix(s, rng, alsoDied),
  );
}

// ---------- powers used in daylight ----------

function terroristBomb(s: GameState, playerId: string, targetId: string, now: number, rng: Rng): string | undefined {
  if (!AWAKE_POWER_PHASES.includes(s.phase)) return "You can only do that while the table is awake: morning, day or vote.";
  const me = findPlayer(s, playerId);
  if (!me || !me.alive || me.role !== "terrorist") return "You aren't a Terrorist.";
  if (me.used) return "You've already used your one shot.";
  const target = findPlayer(s, targetId);
  if (!target || !target.alive || target.id === me.id) return "Pick another living player.";

  me.used = true;
  me.roleRevealed = true; // a bang is hard to hide
  kill(s, me);
  kill(s, target);
  const alsoDied = settleDeaths(s, [me.id, target.id]);
  for (const id of [me.id, target.id, ...alsoDied]) delete s.votes[id];

  const text = [
    narrate("terrorBomb", rng, { name: me.name, target: target.name }),
    loverSuffix(s, rng, alsoDied),
  ]
    .filter(Boolean)
    .join(" ");
  const winner = checkWinner(s);
  if (winner) {
    endGame(s, winner, now, rng, undefined, text);
    return;
  }
  s.narration = { seq: s.narration.seq + 1, event: "terrorBomb", text };
  // Their votes are gone: the rest may now have all voted.
  if (s.phase === "vote" && living(s).every((p) => p.id in s.votes)) resolveVote(s, now, rng);
  return;
}

function judgeOverturn(s: GameState, playerId: string, now: number, rng: Rng): string | undefined {
  if (s.phase !== "voteResult" || !s.voteReport?.pending) return "There's no verdict to overturn right now.";
  const me = findPlayer(s, playerId);
  if (!me || !me.alive || me.role !== "judge") return "You aren't a Judge.";
  if (me.used) return "You've already used your one overturn.";
  me.used = true;
  me.roleRevealed = true;
  s.voteReport.pending = false;
  s.voteReport.overturned = true;
  s.voteReport.eliminatedId = null;
  setPhase(s, "voteResult", now, s.settings.voteResultSeconds);
  say(s, rng, "judgeOverturn", { name: me.name });
  return;
}

function lawyerShield(s: GameState, playerId: string, targetId: string, rng: Rng): string | undefined {
  if (s.phase !== "day" && s.phase !== "vote") return "The Lawyer can only act during the day.";
  const me = findPlayer(s, playerId);
  if (!me || !me.alive || me.role !== "lawyer") return "You aren't a Lawyer.";
  if (me.used) return "You've already used your one shield.";
  const target = findPlayer(s, targetId);
  if (!target || !target.alive) return "Pick a living player.";
  me.used = true;
  me.roleRevealed = true;
  s.immune = { round: s.round, targetId };
  // Anyone who already voted against them may vote again.
  for (const [voter, choice] of Object.entries(s.votes)) if (choice === targetId) delete s.votes[voter];
  say(s, rng, "lawyerShield", { name: me.name, target: target.name });
  return;
}

// ---------- end ----------

function endGame(
  s: GameState,
  winner: Winner,
  now: number,
  rng: Rng,
  vars?: Record<string, string | number>,
  prefix = "",
) {
  s.winner = winner;
  for (const p of s.players) p.roleRevealed = true;
  setPhase(s, "ended", now, null);
  say(s, rng, winner === "village" ? "villageWins" : winner === "mafia" ? "mafiaWins" : "jesterWins", vars, prefix);
}

function endIfWon(s: GameState, now: number, rng: Rng): boolean {
  const winner = checkWinner(s);
  if (!winner) return false;
  endGame(s, winner, now, rng);
  return true;
}

function playAgain(s: GameState, playerId: string, now: number, rng: Rng): string | undefined {
  if (s.phase !== "ended") return "The game isn't over yet.";
  if (s.hostId !== playerId) return "Only the host can start a new game.";
  s.players = s.players.filter((p) => p.isBot || (!p.left && p.connected));
  s.players.forEach((p) => Object.assign(p, freshPlayerState()));
  s.round = 0;
  s.winner = null;
  s.morning = null;
  s.voteReport = null;
  s.detectiveResults = [];
  s.lastDoctorTarget = null;
  s.immune = null;
  s.haunts = [];
  s.notes = [];
  s.nextNoteId = 1;
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
      // The Judge's window closed: the verdict stands.
      if (s.voteReport?.pending) return applyVerdict(s, now, rng);
      if (!endIfWon(s, now, rng)) startNight(s, now, rng);
      return;
  }
}
