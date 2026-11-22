import { describe, expect, it } from "vitest";
import { createGame, reduce } from "../engine";
import { planBotActions } from "../bots";
import { DEALS, DEAL_ORDER, DEFAULT_RULES, dealAvailable, dealOf, dealPatch, sanitizeRules } from "../rules";
import { viewFor } from "../view";
import { SKIP, type GameState, type Role, type Rules } from "../types";
import { act, expire, lobby, ok } from "./helpers";

const find = (s: GameState, id: string) => s.players.find((p) => p.id === id)!;
const BASE: Record<string, Role> = { p1: "mafia", p2: "mafia", p3: "doctor", p4: "detective" };

function game(layout: Record<string, Role>, patch: Partial<Rules>): GameState {
  let s = lobby(7);
  s = act(s, { type: "SET_RULES", playerId: "p0", rules: patch, now: 1 });
  s = act(s, { type: "START", playerId: "p0", now: 2 });
  s = structuredClone(s);
  for (const p of s.players) p.role = layout[p.id] ?? "villager";
  return s;
}
const toNight = (s: GameState) => s.players.reduce((st, p) => act(st, { type: "READY", playerId: p.id, now: 1000 }), s);
const toDay = (s: GameState) => {
  s = toNight(s);
  for (let i = 0; i < 12 && s.phase !== "day"; i++) s = expire(s);
  return s;
};
/** Mafia pick `target`, then the Doctor and Detective steps run out. Ends in the morning. */
function finishNight(s: GameState, target: string): GameState {
  s = act(s, { type: "NIGHT_ACTION", playerId: "p1", targetId: target, now: 1 });
  s = act(s, { type: "NIGHT_ACTION", playerId: "p2", targetId: target, now: 1 });
  return expire(expire(s));
}
const notes = (s: GameState, id: string) => viewFor(s, id).you!.notes.map((n) => n.text);

describe("Night watch", () => {
  const WATCH = { nightWatch: true };

  it("is off by default and can't be used then", () => {
    const s = toNight(game(BASE, {}));
    expect(reduce(s, { type: "NIGHT_WATCH", playerId: "p5", now: 1 }).error).toMatch(/house rules/);
  });

  it("only living non-Mafia players, at night, once", () => {
    let s = toNight(game(BASE, WATCH));
    expect(reduce(s, { type: "NIGHT_WATCH", playerId: "p1", now: 1 }).error).toMatch(/already awake/);
    s = act(s, { type: "NIGHT_WATCH", playerId: "p5", now: 1 });
    expect(reduce(s, { type: "NIGHT_WATCH", playerId: "p5", now: 1 }).error).toMatch(/already/);
    const dead = structuredClone(s);
    find(dead, "p6").alive = false;
    expect(reduce(dead, { type: "NIGHT_WATCH", playerId: "p6", now: 1 }).error).toMatch(/Ghosts/);
    expect(reduce(toDay(game(BASE, WATCH)), { type: "NIGHT_WATCH", playerId: "p5", now: 1 }).error).toMatch(/night/);
  });

  it("the watcher hears a clue at dawn: three names, one of them a real culprit, never themselves", () => {
    let s = toNight(game(BASE, WATCH));
    s = act(s, { type: "NIGHT_WATCH", playerId: "p5", now: 1 });
    s = finishNight(s, "p6");
    expect(s.phase).toBe("morning");
    const clue = notes(s, "p5").at(-1)!;
    expect(clue).toMatch(/noise in the dark/);
    const names = clue.split("one of: ")[1].replace(/\.$/, "").split(", ");
    expect(names).toHaveLength(3);
    expect(new Set(names).size).toBe(3);
    expect(names).not.toContain("P5");
    expect(names.some((n) => n === "P1" || n === "P2")).toBe(true);
  });

  it("the clue is private: nobody else receives it", () => {
    let s = toNight(game(BASE, WATCH));
    s = act(s, { type: "NIGHT_WATCH", playerId: "p5", now: 1 });
    s = finishNight(s, "p6");
    for (const id of ["p0", "p1", "p3", "p4", "p6"]) expect(notes(s, id)).toEqual([]);
    expect(JSON.stringify(viewFor(s, "p0"))).not.toContain("noise in the dark");
  });

  it("no clue if the Mafia did nothing, and none for a watcher who didn't watch", () => {
    let s = toNight(game(BASE, WATCH));
    s = act(s, { type: "NIGHT_WATCH", playerId: "p5", now: 1 });
    s = expire(expire(expire(s))); // nobody acts
    expect(notes(s, "p5").at(-1)).toMatch(/heard nothing/);
    expect(notes(s, "p0")).toEqual([]);
  });

  it("a watcher the Mafia kill hears nothing", () => {
    let s = toNight(game(BASE, WATCH));
    s = act(s, { type: "NIGHT_WATCH", playerId: "p5", now: 1 });
    s = finishNight(s, "p5");
    expect(find(s, "p5").alive).toBe(false);
    expect(notes(s, "p5")).toEqual([]);
  });

  it("the Mafia can tell how many are peeking, and nobody else can", () => {
    let s = toNight(game(BASE, WATCH));
    s = act(s, { type: "NIGHT_WATCH", playerId: "p5", now: 1 });
    s = act(s, { type: "NIGHT_WATCH", playerId: "p6", now: 1 });
    expect(viewFor(s, "p1").you!.watchers).toBe(2);
    expect(viewFor(s, "p2").you!.watchers).toBe(2);
    expect(viewFor(s, "p0").you!.watchers).toBe(0);
    expect(viewFor(s, "p5").you!.watchers).toBe(0);
    expect(viewFor(s, "p5").you!.watching).toBe(true);
    expect(viewFor(s, "p0").you!.watching).toBe(false);
  });

  it("the Doctor and Detective can watch too, between their own steps", () => {
    let s = toNight(game(BASE, WATCH));
    s = act(s, { type: "NIGHT_WATCH", playerId: "p3", now: 1 });
    s = finishNight(s, "p6");
    expect(notes(s, "p3").at(-1)).toMatch(/noise in the dark/);
  });
});

describe("Ghost haunts", () => {
  const HAUNT = { ghostHaunts: true };
  const withGhost = (patch: Partial<Rules> = HAUNT) => {
    const s = toDay(game(BASE, patch));
    find(s, "p6").alive = false; // p6 is a ghost
    return s;
  };

  it("is off by default and can't be used then", () => {
    expect(reduce(withGhost({}), { type: "GHOST_HAUNT", playerId: "p6", targetId: "p0", now: 1 }).error).toMatch(/house rules/);
  });

  it("only ghosts, only in daylight, only at a living target", () => {
    const s = withGhost();
    expect(reduce(s, { type: "GHOST_HAUNT", playerId: "p5", targetId: "p0", now: 1 }).error).toMatch(/Only ghosts/);
    expect(reduce(s, { type: "GHOST_HAUNT", playerId: "p6", targetId: "p6", now: 1 }).error).toMatch(/living/);
    const night = toNight(game(BASE, HAUNT));
    find(night, "p6").alive = false;
    expect(reduce(night, { type: "GHOST_HAUNT", playerId: "p6", targetId: "p0", now: 1 }).error).toMatch(/during the day/);
  });

  it("points the whole town at someone, anonymously", () => {
    let s = withGhost();
    s = act(s, { type: "GHOST_HAUNT", playerId: "p6", targetId: "p0", now: 5 });
    for (const id of ["p0", "p1", "p5"]) {
      const v = viewFor(s, id);
      expect(v.hauntedIds).toEqual(["p0"]);
      expect(v.chat.public!.at(-1)).toMatchObject({ fromId: "system", text: "A ghost points at P0." });
    }
    expect(s.narration.event).toBe("ghostPoints");
    // Nothing the town receives says which ghost did it: the marker is only the target's id,
    // the chat line is from "system", and only the ghost's own view shows its haunt is spent.
    expect(viewFor(s, "p0").hauntedIds).not.toContain("p6");
    expect(viewFor(s, "p0").chat.public!.every((m) => m.fromId !== "p6")).toBe(true);
    for (const id of ["p0", "p1", "p5"]) expect(viewFor(s, id).you!.hauntUsed).toBe(false);
    expect(viewFor(s, "p6").you!.hauntUsed).toBe(true);
  });

  it("works during the vote, once per ghost, and a spent Terrorist can still haunt", () => {
    let s = withGhost();
    find(s, "p6").used = true; // e.g. a Terrorist who already went off
    s = act(s, { type: "SKIP_DISCUSSION", playerId: "p0", now: s.phaseStartedAt });
    expect(s.phase).toBe("vote");
    s = act(s, { type: "GHOST_HAUNT", playerId: "p6", targetId: "p1", now: 5 });
    expect(reduce(s, { type: "GHOST_HAUNT", playerId: "p6", targetId: "p2", now: 6 }).error).toMatch(/already/);
  });

  it("two ghosts can each haunt, and the marker clears the next night", () => {
    let s = withGhost();
    find(s, "p5").alive = false;
    s = act(s, { type: "GHOST_HAUNT", playerId: "p6", targetId: "p0", now: 5 });
    s = act(s, { type: "GHOST_HAUNT", playerId: "p5", targetId: "p1", now: 6 });
    expect(viewFor(s, "p0").hauntedIds.sort()).toEqual(["p0", "p1"]);
    s = act(s, { type: "SKIP_DISCUSSION", playerId: "p0", now: s.phaseStartedAt });
    for (const p of s.players.filter((q) => q.alive)) s = act(s, { type: "VOTE", playerId: p.id, choice: SKIP, now: 1 });
    s = expire(s); // -> night
    expect(viewFor(s, "p0").hauntedIds).toEqual([]);
  });
});

describe("the Chaos and Paranoia deals", () => {
  it("are now fully built, and applying one sets exactly its switches", () => {
    for (const id of DEAL_ORDER) expect(dealAvailable(id), id).toBe(true);
    let s = lobby(7);
    s = act(s, { type: "SET_RULES", playerId: "p0", rules: dealPatch("chaos"), now: 1 });
    expect(dealOf(s.rules)).toBe("chaos");
    expect(s.rules.nightWatch).toBe(true);
    expect(s.rules.lovers).toBe(true);
    s = act(s, { type: "SET_RULES", playerId: "p0", rules: dealPatch("paranoia"), now: 2 });
    expect(dealOf(s.rules)).toBe("paranoia");
    expect(s.rules.nightWatch).toBe(false);
    s = act(s, { type: "SET_RULES", playerId: "p0", rules: dealPatch("classic"), now: 3 });
    expect(s.rules).toEqual({ ...DEFAULT_RULES });
  });

  it("each deal's blurb names its roles", () => {
    expect(DEALS.chaos.blurb).toMatch(/Godfather/);
    expect(DEALS.paranoia.blurb).toMatch(/Defector/);
  });

  it("a Chaos game really deals a Godfather, a Terrorist, a Jester and two Lovers", () => {
    let s = lobby(9);
    s = act(s, { type: "SET_RULES", playerId: "p0", rules: dealPatch("chaos"), now: 1 });
    s = act(s, { type: "START", playerId: "p0", now: 2 });
    const roles = s.players.map((p) => p.role);
    for (const r of ["godfather", "terrorist", "jester"]) expect(roles.filter((x) => x === r), r).toHaveLength(1);
    expect(s.players.filter((p) => p.lover)).toHaveLength(2);
  });
});

describe("simulated games with every feature on", () => {
  it("bots keep watch and haunt, and every game still finishes without an invalid action", () => {
    const seen = new Set<string>();
    for (let seed = 1; seed <= 20; seed++) {
      let s = createGame("SIMUL", seed, 0);
      s = ok(reduce(s, { type: "JOIN", playerId: "host", name: "Host", bodyColor: "#ffffff", skinColor: "#ffffff", now: 0 }));
      s = ok(reduce(s, { type: "ADD_BOTS", playerId: "host", count: 13, now: 0 }));
      const all: Partial<Rules> = sanitizeRules(DEFAULT_RULES, {
        roles: { godfather: true, terrorist: true, judge: true, lawyer: true, heir: true, defector: true, mayor: true, jester: true },
        lovers: true,
        nightWatch: true,
        ghostHaunts: true,
      });
      s = ok(reduce(s, { type: "SET_RULES", playerId: "host", rules: all, now: 0 }));
      s = ok(reduce(s, { type: "START", playerId: "host", now: 0 }));
      let now = 0;
      for (let i = 0; i < 30_000 && s.phase !== "ended"; i++) {
        now += 500;
        for (const a of planBotActions(s, now)) {
          const r = reduce(s, a);
          expect(r.error, `${a.type} in ${s.phase}`).toBeUndefined();
          s = r.state;
          seen.add(a.type);
        }
        if (s.phase === "day" && now - s.phaseStartedAt > 8000) s = ok(reduce(s, { type: "SKIP_DISCUSSION", playerId: "host", now }));
        s = ok(reduce(s, { type: "TICK", now }));
      }
      expect(s.phase, `seed ${seed}`).toBe("ended");
    }
    expect(seen.has("NIGHT_WATCH")).toBe(true);
    expect(seen.has("GHOST_HAUNT")).toBe(true);
  });
});
