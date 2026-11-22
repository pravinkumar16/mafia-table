import { describe, expect, it } from "vitest";
import { migrateState, reduce } from "../engine";
import { mafiaTotal, roleList, validateRules } from "../roles";
import { AVAILABLE_FEATURES, DEFAULT_RULES, DEAL_ORDER, OPTIONAL_ROLES, dealOf, dealPatch, sanitizeRules } from "../rules";
import { viewFor } from "../view";
import type { Rules } from "../types";
import { act, expire, LAYOUT, lobby, ok, startedWith, toNight } from "./helpers";

const rulesWith = (patch: Partial<Rules>): Rules => sanitizeRules(DEFAULT_RULES, patch);
const count = (roles: string[], r: string) => roles.filter((x) => x === r).length;

describe("house rules: Mafia count", () => {
  it("auto matches the original distribution", () => {
    expect(mafiaTotal(7)).toBe(2);
    expect(mafiaTotal(9)).toBe(3);
    expect(mafiaTotal(16)).toBe(4);
  });

  it.each([1, 2, 3])("host-chosen %i Mafia is dealt (rest town)", (m) => {
    const roles = roleList(9, rulesWith({ mafiaCount: m as 1 | 2 | 3 }));
    expect(count(roles, "mafia")).toBe(m);
    expect(count(roles, "doctor")).toBe(1);
    expect(count(roles, "detective")).toBe(1);
    expect(roles).toHaveLength(9);
  });

  it("refuses a Mafia count that starts with the Mafia not outnumbered", () => {
    expect(validateRules(7, rulesWith({ mafiaCount: 4 }))).toMatch(/too many/i);
    expect(validateRules(7, rulesWith({ mafiaCount: 3 }))).toBeNull();
    expect(validateRules(8, rulesWith({ mafiaCount: 4 }))).toMatch(/too many/i);
    expect(validateRules(9, rulesWith({ mafiaCount: 4 }))).toBeNull();
  });

  it("START is refused with a clear reason when the rules can't be dealt", () => {
    let s = lobby(7);
    s = act(s, { type: "SET_RULES", playerId: "p0", rules: { mafiaCount: 4 }, now: 1 });
    const r = reduce(s, { type: "START", playerId: "p0", now: 2 });
    expect(r.error).toMatch(/too many/i);
    expect(r.state.phase).toBe("lobby");
  });

  it("a chosen count is what gets dealt", () => {
    let s = lobby(9);
    s = act(s, { type: "SET_RULES", playerId: "p0", rules: { mafiaCount: 1 }, now: 1 });
    s = act(s, { type: "START", playerId: "p0", now: 2 });
    expect(s.players.filter((p) => p.role === "mafia")).toHaveLength(1);
  });
});

describe("house rules: who may change them", () => {
  it("only the host, only in the lobby", () => {
    const s = lobby(7);
    expect(reduce(s, { type: "SET_RULES", playerId: "p3", rules: { discussionSeconds: 60 }, now: 1 }).error).toMatch(/host/);
    const started = startedWith(7, LAYOUT);
    expect(reduce(started, { type: "SET_RULES", playerId: "p0", rules: { discussionSeconds: 60 }, now: 1 }).error).toMatch(/before the game/);
  });

  it("ignores junk values and unknown keys instead of trusting them", () => {
    const s = act(lobby(7), {
      type: "SET_RULES",
      playerId: "p0",
      rules: { mafiaCount: 99, discussionSeconds: 7, revealRoles: "yes", evil: true, roles: { nonsense: true } },
      now: 1,
    });
    expect(s.rules).toEqual(DEFAULT_RULES);
    for (const junk of [null, "x", 5, [], undefined]) {
      expect(act(lobby(7), { type: "SET_RULES", playerId: "p0", rules: junk, now: 1 }).rules).toEqual(DEFAULT_RULES);
    }
  });

  it("features that aren't built yet can't be switched on", () => {
    const missing = OPTIONAL_ROLES.find((r) => !AVAILABLE_FEATURES.has(r));
    if (!missing) return;
    const s = act(lobby(7), { type: "SET_RULES", playerId: "p0", rules: { roles: { [missing]: true } }, now: 1 });
    expect(s.rules.roles[missing]).toBe(false);
  });

  it("rules carry over to Play again", () => {
    let s = lobby(7);
    s = act(s, { type: "SET_RULES", playerId: "p0", rules: { discussionSeconds: 90, mafiaCount: 3 }, now: 1 });
    s = act(s, { type: "START", playerId: "p0", now: 2 });
    s = structuredClone(s);
    s.phase = "ended";
    s = act(s, { type: "PLAY_AGAIN", playerId: "p0", now: 3 });
    expect(s.rules.discussionSeconds).toBe(90);
    expect(s.rules.mafiaCount).toBe(3);
  });

  it("the rules are public: every player's view has them", () => {
    let s = lobby(7);
    s = act(s, { type: "SET_RULES", playerId: "p0", rules: { discussionSeconds: 120 }, now: 1 });
    for (const id of ["p0", "p4"]) expect(viewFor(s, id).rules.discussionSeconds).toBe(120);
    expect(viewFor(s, null).rules.discussionSeconds).toBe(120);
  });
});

describe("house rules: discussion time", () => {
  it("sets the day timer", () => {
    let s = lobby(7);
    s = act(s, { type: "SET_RULES", playerId: "p0", rules: { discussionSeconds: 60 }, now: 1 });
    expect(s.settings.discussionSeconds).toBe(60);
    s = act(s, { type: "START", playerId: "p0", now: 0 });
    s = toNight(s, 1000);
    s = expire(expire(expire(expire(s)))); // quiet night, morning ends
    expect(s.phase).toBe("day");
    expect(s.phaseEndsAt! - s.phaseStartedAt).toBe(60_000);
  });
});

describe("house rules: show a role when someone is out", () => {
  function nightKill(reveal: boolean) {
    let s = lobby(7);
    s = act(s, { type: "SET_RULES", playerId: "p0", rules: { revealRoles: reveal }, now: 1 });
    s = act(s, { type: "START", playerId: "p0", now: 2 });
    s = structuredClone(s);
    for (const p of s.players) p.role = LAYOUT[p.id];
    s = toNight(s);
    s = act(s, { type: "NIGHT_ACTION", playerId: "p1", targetId: "p5", now: 1 });
    s = act(s, { type: "NIGHT_ACTION", playerId: "p2", targetId: "p5", now: 1 });
    s = act(s, { type: "NIGHT_ACTION", playerId: "p3", targetId: "p6", now: 1 });
    return act(s, { type: "NIGHT_ACTION", playerId: "p4", targetId: "p1", now: 1 });
  }

  it("on (default): the role is revealed, as before", () => {
    const s = nightKill(true);
    expect(s.narration.event).toBe("morningDeath");
    expect(viewFor(s, "p0").players.find((p) => p.id === "p5")!.role).toBe("villager");
  });

  it("off: the death is announced without the role and the card stays hidden", () => {
    const s = nightKill(false);
    expect(s.narration.event).toBe("morningDeathHidden");
    expect(s.narration.text).not.toMatch(/villager/i);
    expect(viewFor(s, "p0").players.find((p) => p.id === "p5")!.role).toBeNull();
    expect(viewFor(s, "p0").players.find((p) => p.id === "p5")!.roleRevealed).toBe(false);
  });

  it("off: a voted-out player's role stays hidden, but everything is shown when the game ends", () => {
    let s = nightKill(false);
    s = expire(s); // morning -> day
    s = act(s, { type: "SKIP_DISCUSSION", playerId: "p0", now: s.phaseStartedAt });
    for (const p of s.players.filter((q) => q.alive)) {
      s = act(s, { type: "VOTE", playerId: p.id, choice: p.id === "p1" ? "p0" : "p1", now: 1 });
    }
    expect(s.voteReport!.eliminatedId).toBe("p1");
    expect(s.narration.event).toBe("voteEliminationHidden");
    expect(viewFor(s, "p0").players.find((p) => p.id === "p1")!.role).toBeNull();
    s = structuredClone(s);
    s.players.find((p) => p.id === "p2")!.alive = false;
    s = expire(s);
    expect(s.phase).toBe("ended");
    expect(viewFor(s, "p0").players.every((p) => p.role !== null)).toBe(true);
  });
});

describe("deals", () => {
  it("every deal is recognised, and Classic is the default", () => {
    expect(dealOf(DEFAULT_RULES)).toBe("classic");
    for (const id of DEAL_ORDER) {
      const rules = { ...DEFAULT_RULES, ...dealPatch(id) } as Rules;
      expect(dealOf(rules)).toBe(id);
    }
    expect(dealOf({ ...DEFAULT_RULES, roles: { ...DEFAULT_RULES.roles, judge: true, mayor: true } })).toBe("custom");
  });

  it("every deal fits a 7-player table once its roles are built", () => {
    for (const id of DEAL_ORDER) {
      const rules = { ...DEFAULT_RULES, ...dealPatch(id) } as Rules;
      expect(validateRules(7, rules), id).toBeNull();
    }
  });
});

describe("saved tables", () => {
  it("a table saved before house rules existed gets the defaults", () => {
    const old = structuredClone(lobby(7)) as unknown as Record<string, unknown>;
    delete old.rules;
    const migrated = migrateState(old as never);
    expect(migrated.rules).toEqual(DEFAULT_RULES);
    expect(ok(reduce(migrated, { type: "START", playerId: "p0", now: 1 })).phase).toBe("roleReveal");
  });
});
