// House rules: defaults, the three deals, and sanitising of untrusted input.
// Pure. The server is the only place rules are changed (see SET_RULES).

import type { DiscussionSeconds, OptionalRole, Rules } from "./types";

export const OPTIONAL_ROLES: readonly OptionalRole[] = [
  "godfather",
  "terrorist",
  "judge",
  "lawyer",
  "heir",
  "defector",
  "mayor",
  "jester",
];

export const DISCUSSION_OPTIONS: readonly DiscussionSeconds[] = [60, 90, 120, 180, 300];
export const MAFIA_COUNT_OPTIONS = [1, 2, 3, 4] as const;

export type Feature = OptionalRole | "lovers" | "nightWatch" | "ghostHaunts";

/**
 * Features whose game logic exists. Anything not listed shows as "coming soon"
 * in the panel and can't be switched on (the server enforces this too).
 */
export const AVAILABLE_FEATURES: ReadonlySet<Feature> = new Set<Feature>([]);

export const DEFAULT_RULES: Rules = {
  mafiaCount: "auto",
  roles: {
    godfather: false,
    terrorist: false,
    judge: false,
    lawyer: false,
    heir: false,
    defector: false,
    mayor: false,
    jester: false,
  },
  lovers: false,
  nightWatch: false,
  ghostHaunts: false,
  discussionSeconds: 180,
  revealRoles: true,
};

export type DealId = "classic" | "chaos" | "paranoia";

export const DEALS: Record<DealId, { title: string; blurb: string; features: readonly Feature[] }> = {
  classic: {
    title: "Classic",
    blurb: "Mafia, a Doctor and a Detective. The game everyone knows.",
    features: [],
  },
  chaos: {
    title: "Chaos",
    blurb: "A Godfather, a Terrorist and a Jester, secret Lovers, and nights you can't fully sleep through.",
    features: ["godfather", "terrorist", "jester", "lovers", "nightWatch", "ghostHaunts"],
  },
  paranoia: {
    title: "Paranoia",
    blurb: "A Godfather the Detective can't read, a Terrorist, a Defector and a Jester. Trust nobody.",
    features: ["godfather", "terrorist", "defector", "jester", "ghostHaunts"],
  },
};

export const DEAL_ORDER: readonly DealId[] = ["classic", "chaos", "paranoia"];

const FEATURE_KEYS: readonly Feature[] = [...OPTIONAL_ROLES, "lovers", "nightWatch", "ghostHaunts"];

export const featureOn = (rules: Rules, f: Feature): boolean =>
  f === "lovers" || f === "nightWatch" || f === "ghostHaunts" ? rules[f] : rules.roles[f];

export const dealAvailable = (deal: DealId) => DEALS[deal].features.every((f) => AVAILABLE_FEATURES.has(f));

/** Which preset the current switches match, or "custom". */
export function dealOf(rules: Rules): DealId | "custom" {
  for (const id of DEAL_ORDER) {
    const want = new Set(DEALS[id].features);
    if (FEATURE_KEYS.every((f) => featureOn(rules, f) === want.has(f))) return id;
  }
  return "custom";
}

/** The patch that applies a deal's switches, leaving Mafia count, timer and reveal alone. */
export function dealPatch(deal: DealId): Partial<Rules> {
  const want = new Set(DEALS[deal].features);
  return {
    roles: Object.fromEntries(OPTIONAL_ROLES.map((r) => [r, want.has(r)])) as Rules["roles"],
    lovers: want.has("lovers"),
    nightWatch: want.has("nightWatch"),
    ghostHaunts: want.has("ghostHaunts"),
  };
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v);

/** Merge an untrusted patch onto `base`. Unknown keys and bad values are ignored. */
export function sanitizeRules(base: Rules, patch: unknown): Rules {
  const out: Rules = structuredClone(base);
  if (!isObj(patch)) return out;

  const m = patch.mafiaCount;
  if (m === "auto" || m === 1 || m === 2 || m === 3 || m === 4) out.mafiaCount = m;

  const flag = (f: Feature, v: unknown, set: (b: boolean) => void) => {
    // Switching off is always allowed; switching on only for built features.
    if (typeof v === "boolean" && (!v || AVAILABLE_FEATURES.has(f))) set(v);
  };
  if (isObj(patch.roles)) {
    for (const r of OPTIONAL_ROLES) flag(r, patch.roles[r], (b) => (out.roles[r] = b));
  }
  flag("lovers", patch.lovers, (b) => (out.lovers = b));
  flag("nightWatch", patch.nightWatch, (b) => (out.nightWatch = b));
  flag("ghostHaunts", patch.ghostHaunts, (b) => (out.ghostHaunts = b));

  if (DISCUSSION_OPTIONS.includes(patch.discussionSeconds as DiscussionSeconds)) {
    out.discussionSeconds = patch.discussionSeconds as DiscussionSeconds;
  }
  if (typeof patch.revealRoles === "boolean") out.revealRoles = patch.revealRoles;
  return out;
}
