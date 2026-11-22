// Pure game types. No network, no UI.

export type Role =
  | "mafia"
  | "doctor"
  | "detective"
  | "villager"
  | "godfather"
  | "terrorist"
  | "judge"
  | "lawyer"
  | "heir"
  | "defector"
  | "mayor"
  | "jester";

/** Roles the host can switch on and off. The Doctor and Detective are always in play. */
export type OptionalRole = "godfather" | "terrorist" | "judge" | "lawyer" | "heir" | "defector" | "mayor" | "jester";

export type DiscussionSeconds = 60 | 90 | 120 | 180 | 300;

/** House rules, chosen by the host in the lobby. Public to everyone at the table. */
export interface Rules {
  mafiaCount: "auto" | 1 | 2 | 3 | 4;
  roles: Record<OptionalRole, boolean>;
  /** Two town players are secretly in love: if one dies, so does the other. */
  lovers: boolean;
  /** Sleepers may keep watch at night for a noisy clue. */
  nightWatch: boolean;
  /** Each ghost may point the town at someone, once a game. */
  ghostHaunts: boolean;
  discussionSeconds: DiscussionSeconds;
  /** Reveal a player's role when they die or are voted out. */
  revealRoles: boolean;
}

export type Phase =
  | "lobby"
  | "roleReveal"
  | "night"
  | "morning"
  | "day"
  | "vote"
  | "voteResult"
  | "ended";

export type NightStep = "mafia" | "doctor" | "detective";

export type Channel = "public" | "mafia" | "ghost";

export type Winner = "village" | "mafia";

export const SKIP = "skip" as const;
export type VoteChoice = string | typeof SKIP;

export interface Player {
  id: string;
  name: string;
  bodyColor: string;
  skinColor: string;
  seat: number;
  isBot: boolean;
  connected: boolean;
  /** ms timestamp of the last disconnect, null while connected */
  disconnectedAt: number | null;
  /** player pressed "Leave table" during a game */
  left: boolean;
  role: Role | null;
  alive: boolean;
  /** set once the role is public (death, vote-out or game over) */
  roleRevealed: boolean;
  ready: boolean;
}

export interface ChatMessage {
  id: number;
  channel: Channel;
  fromId: string;
  fromName: string;
  text: string;
  at: number;
}

export interface Narration {
  seq: number;
  event: NarrationEvent;
  text: string;
}

export type NarrationEvent =
  | "lobby"
  | "roleReveal"
  | "nightFalls"
  | "mafiaWake"
  | "doctorWake"
  | "detectiveWake"
  | "morningDeath"
  | "morningDeathHidden"
  | "morningSaved"
  | "morningQuiet"
  | "dayStart"
  | "voteStart"
  | "voteElimination"
  | "voteEliminationHidden"
  | "voteNoElimination"
  | "villageWins"
  | "mafiaWins";

export interface DetectiveResult {
  round: number;
  targetId: string;
  isMafia: boolean;
}

export interface NightState {
  step: NightStep;
  /** mafia member id -> target id */
  mafiaVotes: Record<string, string>;
  doctorTarget: string | null;
  detectiveTarget: string | null;
}

export interface MorningReport {
  round: number;
  killedId: string | null;
  saved: boolean;
}

export interface VoteReport {
  round: number;
  /** target id or "skip" -> number of votes */
  tally: Record<string, number>;
  /** voter id -> choice. Only public after the vote phase ends. */
  ballots: Record<string, VoteChoice>;
  eliminatedId: string | null;
}

export interface Settings {
  discussionSeconds: number;
  nightStepSeconds: number;
  voteSeconds: number;
  roleRevealSeconds: number;
  morningSeconds: number;
  voteResultSeconds: number;
  /** grace period before a disconnected host is replaced */
  hostGraceSeconds: number;
  /** grace period before a disconnected lobby player loses their seat */
  lobbyGraceSeconds: number;
}

export interface GameState {
  code: string;
  rngSeed: number;
  phase: Phase;
  round: number;
  phaseStartedAt: number;
  phaseEndsAt: number | null;
  hostId: string | null;
  players: Player[];
  night: NightState | null;
  lastDoctorTarget: string | null;
  detectiveResults: DetectiveResult[];
  morning: MorningReport | null;
  votes: Record<string, VoteChoice>;
  voteReport: VoteReport | null;
  winner: Winner | null;
  narration: Narration;
  chat: ChatMessage[];
  nextChatId: number;
  settings: Settings;
  rules: Rules;
}

export type Action =
  | {
      type: "JOIN";
      playerId: string;
      name: string;
      bodyColor: string;
      skinColor: string;
      now: number;
    }
  | { type: "LEAVE"; playerId: string; now: number }
  | { type: "CONNECT"; playerId: string; now: number }
  | { type: "DISCONNECT"; playerId: string; now: number }
  | { type: "ADD_BOTS"; playerId: string; count: number; now: number }
  | { type: "SET_RULES"; playerId: string; rules: unknown; now: number }
  | { type: "START"; playerId: string; now: number }
  | { type: "READY"; playerId: string; now: number }
  | { type: "NIGHT_ACTION"; playerId: string; targetId: string; now: number }
  | { type: "VOTE"; playerId: string; choice: VoteChoice; now: number }
  | { type: "SKIP_DISCUSSION"; playerId: string; now: number }
  | { type: "PLAY_AGAIN"; playerId: string; now: number }
  | { type: "CHAT"; playerId: string; channel: Channel; text: string; now: number }
  | { type: "TICK"; now: number };

export interface ReduceResult {
  state: GameState;
  error?: string;
}
