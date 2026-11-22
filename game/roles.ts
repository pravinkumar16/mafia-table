import type { Role, Rules } from "./types";
import type { Rng } from "./rng";
import { DEFAULT_RULES, OPTIONAL_ROLES } from "./rules";

export const MIN_PLAYERS = 7;
export const MAX_PLAYERS = 16;

/**
 * Automatic Mafia count. 7–8 players: 2 Mafia; 9–12: 3 Mafia; 13+: floor(n / 4).
 */
export function mafiaCount(playerCount: number): number {
  if (playerCount < MIN_PLAYERS) throw new Error(`Need at least ${MIN_PLAYERS} players`);
  if (playerCount <= 8) return 2;
  if (playerCount <= 12) return 3;
  return Math.floor(playerCount / 4);
}

/** Mafia seats for this table: the host's choice, or the automatic count. The Godfather takes one of them. */
export function mafiaTotal(playerCount: number, rules: Rules = DEFAULT_RULES): number {
  return rules.mafiaCount === "auto" ? mafiaCount(Math.max(playerCount, MIN_PLAYERS)) : rules.mafiaCount;
}

/** Every role card for the table, in a fixed order (to be shuffled by the caller). */
export function roleList(playerCount: number, rules: Rules = DEFAULT_RULES): Role[] {
  if (playerCount < MIN_PLAYERS) throw new Error(`Need at least ${MIN_PLAYERS} players`);
  const mafia = mafiaTotal(playerCount, rules);
  const roles: Role[] = [];
  if (rules.roles.godfather) roles.push("godfather");
  while (roles.length < mafia) roles.push("mafia");
  roles.push("doctor", "detective");
  for (const r of OPTIONAL_ROLES) if (r !== "godfather" && rules.roles[r]) roles.push(r);
  while (roles.length < playerCount) roles.push("villager");
  return roles;
}

/** Why these rules can't be dealt to this many players, or null if they can. */
export function validateRules(playerCount: number, rules: Rules): string | null {
  if (playerCount < MIN_PLAYERS) return `The table needs ${MIN_PLAYERS} or more players.`;
  const mafia = mafiaTotal(playerCount, rules);
  if (mafia * 2 >= playerCount) {
    return `${mafia} Mafia is too many for ${playerCount} players: they must start outnumbered.`;
  }
  const needed = mafia + 2 + OPTIONAL_ROLES.filter((r) => r !== "godfather" && rules.roles[r]).length;
  if (needed > playerCount) {
    return `These rules need ${needed} players and there are ${playerCount}. Switch a role off or add players.`;
  }
  return null;
}

export function dealRoles(playerIds: readonly string[], rng: Rng, rules: Rules = DEFAULT_RULES): Record<string, Role> {
  const roles = rng.shuffle(roleList(playerIds.length, rules));
  const out: Record<string, Role> = {};
  playerIds.forEach((id, i) => (out[id] = roles[i]));
  return out;
}

export type Team = "Mafia" | "Village" | "Solo";

export const ROLE_INFO: Record<Role, { title: string; team: Team; blurb: string }> = {
  mafia: {
    title: "Mafia",
    team: "Mafia",
    blurb: "Each night, agree with your crew on someone to eliminate. By day, blend in.",
  },
  godfather: {
    title: "Godfather",
    team: "Mafia",
    blurb: "You run the Mafia. The Detective's check reads you as innocent.",
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
  terrorist: {
    title: "Terrorist",
    team: "Village",
    blurb: "Once a game, while the table is awake, go out with a bang and take one player with you.",
  },
  judge: {
    title: "Judge",
    team: "Village",
    blurb: "Once a game, overturn a vote after the town has chosen someone: nobody leaves that day.",
  },
  lawyer: {
    title: "Lawyer",
    team: "Village",
    blurb: "Once a game, shield one player so the day's vote can't remove them.",
  },
  heir: {
    title: "Heir",
    team: "Village",
    blurb: "No power yet. When a Doctor, Detective, Terrorist, Mayor, Judge or Lawyer dies, you inherit their unused power.",
  },
  defector: {
    title: "Defector",
    team: "Village",
    blurb: "You look like a plain townsperson. If every Mafia member is gone, you join the Mafia.",
  },
  mayor: {
    title: "Mayor",
    team: "Village",
    blurb: "Your vote counts double, and everyone knows who you are.",
  },
  jester: {
    title: "Jester",
    team: "Solo",
    blurb: "You want the town to vote you out. If it does, you win alone.",
  },
};
