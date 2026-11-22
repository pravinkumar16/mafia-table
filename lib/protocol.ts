// Wire protocol between the browser and the PartyKit room.
import type { Channel, PlayerView, VoteChoice } from "../game";

export type ClientMessage =
  | { t: "join"; name: string; bodyColor: string; skinColor: string }
  | { t: "leave" }
  | { t: "setRules"; rules: Record<string, unknown> }
  | { t: "start" }
  | { t: "addBots"; count: number }
  | { t: "ready" }
  | { t: "night"; targetId: string }
  | { t: "vote"; choice: VoteChoice }
  | { t: "bomb"; targetId: string }
  | { t: "overturn" }
  | { t: "shield"; targetId: string }
  | { t: "skipDiscussion" }
  | { t: "playAgain" }
  | { t: "chat"; channel: Channel; text: string }
  | { t: "wave"; targetId: string };

export type ServerMessage =
  | { t: "state"; view: PlayerView; serverNow: number }
  | { t: "welcome"; playerId: string | null; botsAllowed: boolean }
  | { t: "error"; message: string }
  | { t: "wave"; fromId: string; targetId: string };

export const MAX_MESSAGE_BYTES = 2048;
const CHANNELS: Channel[] = ["public", "mafia", "ghost"];
const str = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;

/** Strictly validates untrusted input. Returns null for anything malformed. */
export function parseClientMessage(raw: unknown): ClientMessage | null {
  if (typeof raw !== "string" || raw.length > MAX_MESSAGE_BYTES) return null;
  let m: Record<string, unknown>;
  try {
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    m = parsed;
  } catch {
    return null;
  }
  switch (m.t) {
    case "join":
      if (!str(m.name, 64) || !str(m.bodyColor, 16) || !str(m.skinColor, 16)) return null;
      return { t: "join", name: m.name, bodyColor: m.bodyColor, skinColor: m.skinColor };
    case "leave":
    case "start":
    case "ready":
    case "overturn":
    case "skipDiscussion":
    case "playAgain":
      return { t: m.t };
    case "setRules":
      if (typeof m.rules !== "object" || m.rules === null || Array.isArray(m.rules)) return null;
      return { t: "setRules", rules: m.rules as Record<string, unknown> };
    case "addBots":
      if (typeof m.count !== "number" || !Number.isFinite(m.count)) return null;
      return { t: "addBots", count: Math.max(1, Math.min(16, Math.floor(m.count))) };
    case "night":
      return str(m.targetId, 64) ? { t: "night", targetId: m.targetId } : null;
    case "bomb":
      return str(m.targetId, 64) ? { t: "bomb", targetId: m.targetId } : null;
    case "shield":
      return str(m.targetId, 64) ? { t: "shield", targetId: m.targetId } : null;
    case "vote":
      return str(m.choice, 64) ? { t: "vote", choice: m.choice } : null;
    case "chat":
      if (!CHANNELS.includes(m.channel as Channel) || !str(m.text, 1000)) return null;
      return { t: "chat", channel: m.channel as Channel, text: m.text };
    case "wave":
      return str(m.targetId, 64) ? { t: "wave", targetId: m.targetId } : null;
    default:
      return null;
  }
}

/** Reconnect secrets are random UUIDs kept in localStorage. */
export const isValidSecret = (s: unknown): s is string => typeof s === "string" && /^[A-Za-z0-9-]{16,64}$/.test(s);

export const ROOM_CODE_RE = /^[A-Z]{5}$/;
