import { createGame, reduce } from "../engine";
import type { Action, GameState, ReduceResult, Role } from "../types";

export const ok = (r: ReduceResult): GameState => {
  if (r.error) throw new Error(r.error);
  return r.state;
};

export const ids = (n: number) => Array.from({ length: n }, (_, i) => `p${i}`);

export function lobby(n: number, seed = 42): GameState {
  let s = createGame("ABCDE", seed, 0);
  for (const id of ids(n)) {
    s = ok(reduce(s, { type: "JOIN", playerId: id, name: id.toUpperCase(), bodyColor: "#112233", skinColor: "#445566", now: 0 }));
  }
  return s;
}

/** Start a game and force a role layout. Unlisted players are villagers. */
export function startedWith(n: number, roles: Record<string, Role>, seed = 42): GameState {
  let s = ok(reduce(lobby(n, seed), { type: "START", playerId: "p0", now: 0 }));
  s = structuredClone(s);
  for (const p of s.players) p.role = roles[p.id] ?? "villager";
  return s;
}

/** Everyone presses ready: night begins on the Mafia step. */
export function toNight(s: GameState, now = 1000): GameState {
  for (const p of s.players) s = ok(reduce(s, { type: "READY", playerId: p.id, now }));
  return s;
}

export const act = (s: GameState, a: Action) => ok(reduce(s, a));

export const tickTo = (s: GameState, now: number) => ok(reduce(s, { type: "TICK", now }));

/** Jump past the current phase's deadline. */
export const expire = (s: GameState) => tickTo(s, (s.phaseEndsAt ?? s.phaseStartedAt) + 1);

// Standard 7-player layout used across tests.
export const LAYOUT: Record<string, Role> = {
  p0: "villager",
  p1: "mafia",
  p2: "mafia",
  p3: "doctor",
  p4: "detective",
  p5: "villager",
  p6: "villager",
};
