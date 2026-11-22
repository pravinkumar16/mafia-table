import type { Role } from "./types";
import type { Rng } from "./rng";

export const MIN_PLAYERS = 7;
export const MAX_PLAYERS = 16;

/**
 * 7–8 players: 2 Mafia; 9–12: 3 Mafia; 13+: floor(n / 4) Mafia.
 * Always 1 Doctor and 1 Detective; everyone else is a Villager.
 */
export function mafiaCount(playerCount: number): number {
  if (playerCount < MIN_PLAYERS) throw new Error(`Need at least ${MIN_PLAYERS} players`);
  if (playerCount <= 8) return 2;
  if (playerCount <= 12) return 3;
  return Math.floor(playerCount / 4);
}

export function roleList(playerCount: number): Role[] {
  const mafia = mafiaCount(playerCount);
  const roles: Role[] = [];
  for (let i = 0; i < mafia; i++) roles.push("mafia");
  roles.push("doctor", "detective");
  while (roles.length < playerCount) roles.push("villager");
  return roles;
}

export function dealRoles(playerIds: readonly string[], rng: Rng): Record<string, Role> {
  const roles = rng.shuffle(roleList(playerIds.length));
  const out: Record<string, Role> = {};
  playerIds.forEach((id, i) => (out[id] = roles[i]));
  return out;
}

export const ROLE_INFO: Record<Role, { title: string; team: "Mafia" | "Village"; blurb: string }> = {
  mafia: {
    title: "Mafia",
    team: "Mafia",
    blurb: "Each night, agree with your crew on someone to eliminate. By day, blend in.",
  },
  doctor: {
    title: "Doctor",
    team: "Village",
    blurb: "Each night, protect one player. You can't protect the same player two nights running.",
  },
  detective: {
    title: "Detective",
    team: "Village",
    blurb: "Each night, investigate one player and learn whether they are Mafia.",
  },
  villager: {
    title: "Villager",
    team: "Village",
    blurb: "No night powers, just your wits. Find the Mafia and vote them out.",
  },
};
