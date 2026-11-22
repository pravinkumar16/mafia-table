// Builds the ONLY thing a client ever receives: a view of the game filtered
// for one player. Hidden roles, night actions and vote targets are stripped
// here, so a client can't leak what it was never sent.

import {
  canReadChannel,
  canWriteChannel,
  findPlayer,
  hasActedTonight,
  immuneToday,
  isMafiaTeam,
  nightStepOf,
  validNightTargets,
} from "./engine";
import type {
  Channel,
  ChatMessage,
  DetectiveResult,
  GameState,
  MorningReport,
  Narration,
  NightStep,
  Phase,
  PrivateNote,
  Role,
  Rules,
  Settings,
  VoteChoice,
  VoteReport,
  Winner,
} from "./types";

export interface PublicPlayer {
  id: string;
  name: string;
  bodyColor: string;
  skinColor: string;
  seat: number;
  isBot: boolean;
  connected: boolean;
  left: boolean;
  alive: boolean;
  isHost: boolean;
  /** Only set when the role is public, or for your own seat, or your Mafia teammates. */
  role: Role | null;
  roleRevealed: boolean;
  /** During the vote: whether they've voted (never who for). */
  hasVoted: boolean;
  /** Only once the game is over: this player began as a Defector and turned Mafia. */
  defected: boolean;
}

export interface YouView {
  id: string;
  role: Role | null;
  alive: boolean;
  ready: boolean;
  isHost: boolean;
  /** Night: is it my step, who can I pick, have I acted, and what did I pick? */
  myTurn: boolean;
  targets: string[];
  acted: boolean;
  myPick: string | null;
  myVote: VoteChoice | null;
  /** Doctor only */
  lastProtectedId: string | null;
  /** Detective only */
  detectiveResults: DetectiveResult[];
  /** Mafia only: teammate ids and their current night votes */
  mafiaTeam: string[];
  mafiaVotes: Record<string, string>;
  /** A once-a-game power (Terrorist, Judge, Lawyer) is spent. */
  used: boolean;
  /** Lovers only: who you are in love with. */
  loverId: string | null;
  /** Private messages, yours alone. */
  notes: PrivateNote[];
  /** Night watch: you're keeping watch tonight. */
  watching: boolean;
  /** Mafia only, at night: how many sleepers are keeping watch. */
  watchers: number;
  /** Ghosts: your one haunt is spent. */
  hauntUsed: boolean;
}

export interface PlayerView {
  code: string;
  phase: Phase;
  nightStep: NightStep | null;
  round: number;
  phaseStartedAt: number;
  phaseEndsAt: number | null;
  hostId: string | null;
  players: PublicPlayer[];
  you: YouView | null;
  narration: Narration;
  morning: MorningReport | null;
  /** Only once the vote is over. */
  voteReport: VoteReport | null;
  votesCast: number;
  /** The Lawyer's shield for today, which is public. */
  immuneId: string | null;
  /** Living players a ghost pointed at today. Which ghost is never sent. */
  hauntedIds: string[];
  winner: Winner | null;
  chat: Partial<Record<Channel, ChatMessage[]>>;
  canWrite: Record<Channel, boolean>;
  settings: Settings;
  /** House rules are public: everyone at the table can see which roles are in play. */
  rules: Rules;
}

export function viewFor(s: GameState, playerId: string | null): PlayerView {
  const me = findPlayer(s, playerId);
  const iAmMafia = isMafiaTeam(me?.role) && s.phase !== "lobby";
  const night = s.phase === "night" ? s.night : null;

  const players: PublicPlayer[] = s.players.map((p) => {
    const visibleRole =
      p.roleRevealed || p.id === me?.id || (iAmMafia && isMafiaTeam(p.role)) ? p.role : null;
    return {
      id: p.id,
      name: p.name,
      bodyColor: p.bodyColor,
      skinColor: p.skinColor,
      seat: p.seat,
      isBot: p.isBot,
      connected: p.connected,
      left: p.left,
      alive: p.alive,
      isHost: p.id === s.hostId,
      role: visibleRole,
      roleRevealed: p.roleRevealed,
      hasVoted: s.phase === "vote" && p.id in s.votes,
      defected: s.phase === "ended" && p.defected,
    };
  });

  let you: YouView | null = null;
  if (me) {
    const myTurn = !!night && me.alive && nightStepOf(me.role) === night.step;
    let myPick: string | null = null;
    if (myTurn && night) {
      if (night.step === "mafia") myPick = night.mafiaVotes[me.id] ?? null;
      if (night.step === "doctor") myPick = night.doctorTarget;
      if (night.step === "detective") myPick = night.detectiveTarget;
    }
    you = {
      id: me.id,
      role: me.role,
      alive: me.alive,
      ready: me.ready,
      isHost: me.id === s.hostId,
      myTurn,
      targets: myTurn ? validNightTargets(s, me.id) : [],
      acted: myTurn ? (night!.step === "mafia" ? me.id in night!.mafiaVotes : hasActedTonight(s, me.id)) : false,
      myPick,
      myVote: s.phase === "vote" ? (s.votes[me.id] ?? null) : null,
      lastProtectedId: me.role === "doctor" ? s.lastDoctorTarget : null,
      detectiveResults: me.role === "detective" ? s.detectiveResults.map((r) => ({ ...r })) : [],
      mafiaTeam: iAmMafia ? s.players.filter((p) => isMafiaTeam(p.role)).map((p) => p.id) : [],
      mafiaVotes: iAmMafia && night ? { ...night.mafiaVotes } : {},
      used: me.used,
      loverId: me.lover,
      notes: s.notes.filter((n) => n.playerId === me.id).map((n) => ({ ...n })),
      watching: !!night && night.watchers.includes(me.id),
      watchers: iAmMafia && night ? night.watchers.length : 0,
      hauntUsed: me.hauntUsed,
    };
  }

  const channels: Channel[] = ["public", "mafia", "ghost"];
  const chat: Partial<Record<Channel, ChatMessage[]>> = {};
  const canWrite = { public: false, mafia: false, ghost: false } as Record<Channel, boolean>;
  for (const c of channels) {
    if (c === "public" || canReadChannel(s, me, c)) chat[c] = s.chat.filter((m) => m.channel === c);
    canWrite[c] = canWriteChannel(s, me, c);
  }

  const showVoteReport = s.phase !== "vote" && s.voteReport && s.voteReport.round === s.round;

  return {
    code: s.code,
    phase: s.phase,
    nightStep: night ? night.step : null,
    round: s.round,
    phaseStartedAt: s.phaseStartedAt,
    phaseEndsAt: s.phaseEndsAt,
    hostId: s.hostId,
    players,
    you,
    narration: s.narration,
    morning: s.morning ? { ...s.morning } : null,
    voteReport: showVoteReport ? structuredClone(s.voteReport) : null,
    votesCast: s.phase === "vote" ? Object.keys(s.votes).length : 0,
    immuneId: s.phase === "day" || s.phase === "vote" ? immuneToday(s) : null,
    hauntedIds:
      s.phase === "day" || s.phase === "vote"
        ? s.haunts.filter((h) => h.round === s.round && findPlayer(s, h.targetId)?.alive).map((h) => h.targetId)
        : [],
    winner: s.winner,
    chat,
    canWrite,
    settings: s.settings,
    rules: structuredClone(s.rules),
  };
}
