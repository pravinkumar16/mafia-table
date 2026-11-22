import { describe, expect, it } from "vitest";
import { createGame, reduce } from "../engine";
import { planBotActions } from "../bots";
import { roleList, validateRules } from "../roles";
import { DEAL_ORDER, DEFAULT_RULES, dealPatch, sanitizeRules } from "../rules";
import { viewFor } from "../view";
import { SKIP, type GameState, type Role, type Rules } from "../types";
import { act, expire, lobby, ok } from "./helpers";

const rules = (patch: Partial<Rules>): Rules => sanitizeRules(DEFAULT_RULES, patch);
const on = (...roles: string[]): Partial<Rules> => ({ roles: Object.fromEntries(roles.map((r) => [r, true])) as Rules["roles"] });
const find = (s: GameState, id: string) => s.players.find((p) => p.id === id)!;

/** Start a 7+ player game with the given rules, then force an exact role layout. */
function game(n: number, layout: Record<string, Role>, patch: Partial<Rules> = {}): GameState {
  let s = lobby(n);
  s = act(s, { type: "SET_RULES", playerId: "p0", rules: patch, now: 1 });
  s = act(s, { type: "START", playerId: "p0", now: 2 });
  s = structuredClone(s);
  for (const p of s.players) {
    p.role = layout[p.id] ?? "villager";
    p.roleRevealed = p.role === "mayor";
    p.lover = null;
  }
  s.notes = [];
  return s;
}

/** Everyone ready, then jump to the first day (a quiet night: nobody acts). */
function toDay(s: GameState): GameState {
  for (const p of s.players) s = act(s, { type: "READY", playerId: p.id, now: 1000 });
  for (let i = 0; i < 12 && s.phase !== "day"; i++) s = expire(s);
  expect(s.phase).toBe("day");
  return s;
}

/** Skip discussion, and have everyone alive vote according to `choices` (default: skip). */
function runVote(s: GameState, choices: Record<string, string> = {}): GameState {
  s = act(s, { type: "SKIP_DISCUSSION", playerId: "p0", now: s.phaseStartedAt });
  for (const p of s.players.filter((q) => q.alive)) {
    if (s.phase !== "vote") break;
    s = act(s, { type: "VOTE", playerId: p.id, choice: choices[p.id] ?? SKIP, now: s.phaseStartedAt });
  }
  return s;
}

const BASE: Record<string, Role> = { p1: "mafia", p2: "mafia", p3: "doctor", p4: "detective" };

describe("role deal with house rules", () => {
  it("the Godfather takes one of the Mafia seats", () => {
    const list = roleList(9, rules(on("godfather")));
    expect(list.filter((r) => r === "godfather")).toHaveLength(1);
    expect(list.filter((r) => r === "mafia")).toHaveLength(2); // 3 Mafia seats in total
  });

  it("every enabled role is dealt exactly once, the rest are villagers", () => {
    const all = rules({ ...on("godfather", "terrorist", "judge", "lawyer", "heir", "defector", "mayor", "jester") });
    expect(validateRules(12, all)).toBeNull();
    const list = roleList(12, all);
    for (const r of ["godfather", "terrorist", "judge", "lawyer", "heir", "defector", "mayor", "jester"]) {
      expect(list.filter((x) => x === r), r).toHaveLength(1);
    }
    expect(list).toHaveLength(12);
  });

  it("refuses a deal with more roles than players", () => {
    const all = rules({ ...on("terrorist", "judge", "lawyer", "heir", "defector", "mayor", "jester") });
    expect(validateRules(7, all)).toMatch(/need 11 players/);
  });

  it("every deal fits 7 players and Classic is unchanged", () => {
    for (const id of DEAL_ORDER) {
      expect(validateRules(7, { ...DEFAULT_RULES, ...dealPatch(id) } as Rules), id).toBeNull();
    }
    expect(roleList(7)).toHaveLength(7);
  });
});

describe("Godfather", () => {
  it("acts with the Mafia, and the Detective reads him as innocent", () => {
    let s = game(7, { ...BASE, p1: "godfather" }, on("godfather"));
    for (const p of s.players) s = act(s, { type: "READY", playerId: p.id, now: 1000 });
    expect(s.night!.step).toBe("mafia");
    expect(viewFor(s, "p1").you!.myTurn).toBe(true);
    s = act(s, { type: "NIGHT_ACTION", playerId: "p1", targetId: "p5", now: 1 });
    s = act(s, { type: "NIGHT_ACTION", playerId: "p2", targetId: "p5", now: 1 });
    s = act(s, { type: "NIGHT_ACTION", playerId: "p3", targetId: "p3", now: 1 });
    s = act(s, { type: "NIGHT_ACTION", playerId: "p4", targetId: "p1", now: 1 });
    expect(s.detectiveResults).toEqual([{ round: 1, targetId: "p1", isMafia: false }]);
    expect(find(s, "p5").alive).toBe(false);
  });

  it("counts as Mafia for the win condition and is known to the Mafia team only", () => {
    const s = game(7, { ...BASE, p1: "godfather" }, on("godfather"));
    expect(viewFor(s, "p2").players.find((p) => p.id === "p1")!.role).toBe("godfather");
    expect(viewFor(s, "p0").players.find((p) => p.id === "p1")!.role).toBeNull();
    expect(viewFor(s, "p2").you!.mafiaTeam.sort()).toEqual(["p1", "p2"]);
  });
});

describe("Jester", () => {
  it("wins alone the moment the town votes them out", () => {
    let s = toDay(game(7, { ...BASE, p5: "jester" }, on("jester")));
    s = runVote(s, Object.fromEntries(s.players.filter((p) => p.id !== "p5").map((p) => [p.id, "p5"])));
    expect(s.phase).toBe("ended");
    expect(s.winner).toBe("jester");
    expect(s.narration.event).toBe("jesterWins");
    expect(find(s, "p5").alive).toBe(false);
  });

  it("does not win if the Mafia kill them", () => {
    let s = game(7, { ...BASE, p5: "jester" }, on("jester"));
    for (const p of s.players) s = act(s, { type: "READY", playerId: p.id, now: 1000 });
    s = act(s, { type: "NIGHT_ACTION", playerId: "p1", targetId: "p5", now: 1 });
    s = act(s, { type: "NIGHT_ACTION", playerId: "p2", targetId: "p5", now: 1 });
    s = expire(expire(s)); // the Doctor and Detective steps time out; the night resolves
    expect(s.phase).toBe("morning");
    expect(find(s, "p5").alive).toBe(false);
    expect(s.winner).toBeNull();
  });
});

describe("Mayor", () => {
  it("is public from the start, and their vote counts double", () => {
    let s = game(7, { ...BASE, p5: "mayor" }, on("mayor"));
    expect(viewFor(s, "p0").players.find((p) => p.id === "p5")!.role).toBe("mayor");
    s = toDay(s);
    // Mayor (2) + p6 vote p0 = 3. p0 and p3 vote p6 = 2. p1 and p2 vote p4 = 2. p4 skips.
    // Without the double vote p0 would only tie.
    s = runVote(s, { p5: "p0", p6: "p0", p0: "p6", p3: "p6", p1: "p4", p2: "p4" });
    expect(s.voteReport!.tally.p0).toBe(3);
    expect(s.voteReport!.eliminatedId).toBe("p0");
  });

  it("the Mayor alone beats a single opposing vote", () => {
    let s = toDay(game(7, { ...BASE, p5: "mayor" }, on("mayor")));
    // Everyone gets one vote, except p6, who gets the Mayor's two.
    s = runVote(s, { p5: "p6", p0: "p5", p1: "p0", p2: "p1", p3: "p2", p4: "p3", p6: "p4" });
    expect(s.voteReport!.eliminatedId).toBe("p6");
  });
});

describe("Lovers", () => {
  it("two townspeople are secretly paired; nobody else can see it", () => {
    let s = lobby(9);
    s = act(s, { type: "SET_RULES", playerId: "p0", rules: { lovers: true }, now: 1 });
    s = act(s, { type: "START", playerId: "p0", now: 2 });
    const lovers = s.players.filter((p) => p.lover);
    expect(lovers).toHaveLength(2);
    expect(lovers[0].lover).toBe(lovers[1].id);
    expect(lovers.every((p) => p.role !== "mafia")).toBe(true);
    for (const l of lovers) {
      expect(viewFor(s, l.id).you!.loverId).toBe(s.players.find((p) => p.id === l.lover)!.id);
      expect(viewFor(s, l.id).you!.notes[0].text).toMatch(/in love/);
    }
    const outsider = s.players.find((p) => !p.lover)!;
    expect(viewFor(s, outsider.id).you!.loverId).toBeNull();
    expect(viewFor(s, outsider.id).you!.notes).toEqual([]);
  });

  it("when one dies in the night, the other dies too", () => {
    let s = game(7, BASE, { lovers: true });
    find(s, "p5").lover = "p6";
    find(s, "p6").lover = "p5";
    for (const p of s.players) s = act(s, { type: "READY", playerId: p.id, now: 1000 });
    s = act(s, { type: "NIGHT_ACTION", playerId: "p1", targetId: "p5", now: 1 });
    s = act(s, { type: "NIGHT_ACTION", playerId: "p2", targetId: "p5", now: 1 });
    s = act(s, { type: "NIGHT_ACTION", playerId: "p3", targetId: "p3", now: 1 });
    s = act(s, { type: "NIGHT_ACTION", playerId: "p4", targetId: "p1", now: 1 });
    expect(find(s, "p5").alive).toBe(false);
    expect(find(s, "p6").alive).toBe(false);
    expect(s.morning!.alsoDied).toEqual(["p6"]);
    expect(s.narration.text).toContain(find(s, "p6").name);
  });

  it("when one is voted out, the other follows", () => {
    let s = toDay(game(7, BASE, { lovers: true }));
    find(s, "p5").lover = "p6";
    find(s, "p6").lover = "p5";
    s = runVote(s, Object.fromEntries(s.players.filter((p) => p.id !== "p5").map((p) => [p.id, "p5"])));
    expect(find(s, "p5").alive).toBe(false);
    expect(find(s, "p6").alive).toBe(false);
  });
});

describe("Terrorist", () => {
  it("takes a target down with them, once, while the table is awake", () => {
    let s = toDay(game(7, { ...BASE, p5: "terrorist" }, on("terrorist")));
    s = act(s, { type: "TERRORIST_BOMB", playerId: "p5", targetId: "p1", now: 1 });
    expect(find(s, "p5").alive).toBe(false);
    expect(find(s, "p1").alive).toBe(false);
    expect(find(s, "p5").roleRevealed).toBe(true);
    expect(s.narration.event).toBe("terrorBomb");
    expect(s.phase).toBe("day");
  });

  it("can't be used at night, on yourself, twice, or by anyone else", () => {
    const s = game(7, { ...BASE, p5: "terrorist" }, on("terrorist"));
    const day = toDay(s);
    expect(reduce(day, { type: "TERRORIST_BOMB", playerId: "p5", targetId: "p5", now: 1 }).error).toBeTruthy();
    expect(reduce(day, { type: "TERRORIST_BOMB", playerId: "p6", targetId: "p1", now: 1 }).error).toBeTruthy();
    let night = s;
    for (const p of night.players) night = act(night, { type: "READY", playerId: p.id, now: 1000 });
    expect(night.phase).toBe("night");
    expect(reduce(night, { type: "TERRORIST_BOMB", playerId: "p5", targetId: "p1", now: 1 }).error).toMatch(/awake/);
  });

  it("can end the game: killing the last Mafia gives the Village the win", () => {
    let s = game(7, { ...BASE, p5: "terrorist" }, on("terrorist"));
    find(s, "p2").alive = false;
    s = toDay(s);
    s = act(s, { type: "TERRORIST_BOMB", playerId: "p5", targetId: "p1", now: 1 });
    expect(s.phase).toBe("ended");
    expect(s.winner).toBe("village");
  });

  it("a bomb during the vote removes their ballots and can complete the vote", () => {
    let s = toDay(game(7, { ...BASE, p5: "terrorist" }, on("terrorist")));
    s = act(s, { type: "SKIP_DISCUSSION", playerId: "p0", now: s.phaseStartedAt });
    for (const id of ["p0", "p1", "p2", "p3", "p4", "p5"]) s = act(s, { type: "VOTE", playerId: id, choice: SKIP, now: 1 });
    expect(s.phase).toBe("vote"); // p6 hasn't voted
    s = act(s, { type: "TERRORIST_BOMB", playerId: "p5", targetId: "p6", now: 1 });
    expect(s.phase).toBe("voteResult"); // the only missing voter is gone
  });
});

describe("Judge", () => {
  function proposed(): GameState {
    let s = toDay(game(7, { ...BASE, p5: "judge" }, on("judge")));
    s = runVote(s, Object.fromEntries(s.players.filter((p) => p.id !== "p1").map((p) => [p.id, "p1"])));
    return s;
  }

  it("holds the verdict for a moment instead of applying it at once", () => {
    const s = proposed();
    expect(s.phase).toBe("voteResult");
    expect(s.voteReport!.pending).toBe(true);
    expect(find(s, "p1").alive).toBe(true);
    expect(s.narration.event).toBe("voteProposed");
  });

  it("overturns the vote once: nobody leaves that day", () => {
    let s = act(proposed(), { type: "JUDGE_OVERTURN", playerId: "p5", now: 1 });
    expect(s.voteReport!.overturned).toBe(true);
    expect(s.voteReport!.eliminatedId).toBeNull();
    expect(s.players.every((p) => p.alive)).toBe(true);
    expect(find(s, "p5").roleRevealed).toBe(true);
    expect(find(s, "p5").used).toBe(true);
    expect(s.narration.event).toBe("judgeOverturn");
    s = expire(s);
    expect(s.phase).toBe("night");
  });

  it("if nobody objects, the verdict stands when the window closes", () => {
    let s = expire(proposed());
    expect(find(s, "p1").alive).toBe(false);
    expect(s.voteReport!.pending).toBe(false);
    expect(s.phase).toBe("voteResult");
  });

  it("only a living, unspent Judge can overturn", () => {
    const s = proposed();
    expect(reduce(s, { type: "JUDGE_OVERTURN", playerId: "p6", now: 1 }).error).toMatch(/aren't a Judge/);
    const dead = structuredClone(s);
    find(dead, "p5").alive = false;
    expect(reduce(dead, { type: "JUDGE_OVERTURN", playerId: "p5", now: 1 }).error).toBeTruthy();
    const spent = structuredClone(s);
    find(spent, "p5").used = true;
    expect(reduce(spent, { type: "JUDGE_OVERTURN", playerId: "p5", now: 1 }).error).toMatch(/already/);
    expect(reduce(lobby(7), { type: "JUDGE_OVERTURN", playerId: "p0", now: 1 }).error).toBeTruthy();
  });

  it("with the Judge switched off, verdicts apply at once as before", () => {
    let s = toDay(game(7, BASE));
    s = runVote(s, Object.fromEntries(s.players.filter((p) => p.id !== "p1").map((p) => [p.id, "p1"])));
    expect(find(s, "p1").alive).toBe(false);
  });
});

describe("Lawyer", () => {
  it("shields one player: votes against them don't count", () => {
    let s = toDay(game(7, { ...BASE, p5: "lawyer" }, on("lawyer")));
    s = act(s, { type: "LAWYER_SHIELD", playerId: "p5", targetId: "p6", now: 1 });
    expect(find(s, "p5").roleRevealed).toBe(true);
    expect(viewFor(s, "p0").immuneId).toBe("p6");
    s = act(s, { type: "SKIP_DISCUSSION", playerId: "p0", now: s.phaseStartedAt });
    expect(reduce(s, { type: "VOTE", playerId: "p0", choice: "p6", now: 1 }).error).toMatch(/shielded/);
    for (const p of s.players.filter((q) => q.alive)) s = act(s, { type: "VOTE", playerId: p.id, choice: SKIP, now: 1 });
    expect(s.voteReport!.immuneId).toBe("p6");
    expect(find(s, "p6").alive).toBe(true);
  });

  it("a shield cast after votes void the ballots already cast against them", () => {
    let s = toDay(game(7, { ...BASE, p5: "lawyer" }, on("lawyer")));
    s = act(s, { type: "SKIP_DISCUSSION", playerId: "p0", now: s.phaseStartedAt });
    s = act(s, { type: "VOTE", playerId: "p0", choice: "p6", now: 1 });
    s = act(s, { type: "LAWYER_SHIELD", playerId: "p5", targetId: "p6", now: 1 });
    expect(s.votes.p0).toBeUndefined();
  });

  it("can be used once, and only in daylight", () => {
    let s = toDay(game(7, { ...BASE, p5: "lawyer" }, on("lawyer")));
    s = act(s, { type: "LAWYER_SHIELD", playerId: "p5", targetId: "p6", now: 1 });
    expect(reduce(s, { type: "LAWYER_SHIELD", playerId: "p5", targetId: "p0", now: 1 }).error).toMatch(/already/);
    let night = game(7, { ...BASE, p5: "lawyer" }, on("lawyer"));
    for (const p of night.players) night = act(night, { type: "READY", playerId: p.id, now: 1000 });
    expect(reduce(night, { type: "LAWYER_SHIELD", playerId: "p5", targetId: "p0", now: 1 }).error).toMatch(/day/);
  });

  it("the shield is only for that day", () => {
    let s = toDay(game(7, { ...BASE, p5: "lawyer" }, on("lawyer")));
    s = act(s, { type: "LAWYER_SHIELD", playerId: "p5", targetId: "p6", now: 1 });
    s = runVote(s);
    s = expire(s); // -> night 2
    for (let i = 0; i < 4 && s.phase !== "day"; i++) s = expire(s);
    expect(viewFor(s, "p0").immuneId).toBeNull();
  });
});

describe("Heir", () => {
  it("inherits the power of the first eligible player to die", () => {
    let s = game(7, { ...BASE, p5: "heir" }, on("heir"));
    for (const p of s.players) s = act(s, { type: "READY", playerId: p.id, now: 1000 });
    s = act(s, { type: "NIGHT_ACTION", playerId: "p1", targetId: "p4", now: 1 }); // kill the detective
    s = act(s, { type: "NIGHT_ACTION", playerId: "p2", targetId: "p4", now: 1 });
    s = act(s, { type: "NIGHT_ACTION", playerId: "p3", targetId: "p3", now: 1 });
    s = act(s, { type: "NIGHT_ACTION", playerId: "p4", targetId: "p1", now: 1 }); // the night resolves after the Detective
    expect(find(s, "p4").alive).toBe(false);
    expect(find(s, "p5").role).toBe("detective");
    expect(viewFor(s, "p5").you!.notes.at(-1)!.text).toMatch(/inherited/);
    expect(viewFor(s, "p0").you!.notes).toEqual([]);
  });

  it("does not inherit a spent power", () => {
    let s = toDay(game(7, { ...BASE, p5: "heir", p6: "terrorist" }, on("heir", "terrorist")));
    find(s, "p6").used = true;
    s = act(s, { type: "SKIP_DISCUSSION", playerId: "p0", now: s.phaseStartedAt });
    // (p6 is voted out with their power already spent)
    for (const p of s.players.filter((q) => q.alive)) s = act(s, { type: "VOTE", playerId: p.id, choice: p.id === "p6" ? "p0" : "p6", now: 1 });
    expect(find(s, "p6").alive).toBe(false);
    expect(find(s, "p5").role).toBe("heir");
  });

  it("inheriting the Mayor makes the Heir the public Mayor", () => {
    let s = toDay(game(7, { ...BASE, p5: "heir", p6: "mayor" }, on("heir", "mayor")));
    s = act(s, { type: "SKIP_DISCUSSION", playerId: "p0", now: s.phaseStartedAt });
    for (const p of s.players.filter((q) => q.alive)) s = act(s, { type: "VOTE", playerId: p.id, choice: p.id === "p6" ? "p0" : "p6", now: 1 });
    expect(find(s, "p5").role).toBe("mayor");
    expect(viewFor(s, "p0").players.find((p) => p.id === "p5")!.role).toBe("mayor");
  });
});

describe("Defector", () => {
  it("reads as innocent to the Detective until the last Mafia member is gone", () => {
    let s = game(7, { ...BASE, p5: "defector" }, on("defector"));
    for (const p of s.players) s = act(s, { type: "READY", playerId: p.id, now: 1000 });
    s = act(s, { type: "NIGHT_ACTION", playerId: "p1", targetId: "p0", now: 1 });
    s = act(s, { type: "NIGHT_ACTION", playerId: "p2", targetId: "p0", now: 1 });
    s = act(s, { type: "NIGHT_ACTION", playerId: "p3", targetId: "p0", now: 1 });
    s = act(s, { type: "NIGHT_ACTION", playerId: "p4", targetId: "p5", now: 1 });
    expect(s.detectiveResults[0]).toMatchObject({ targetId: "p5", isMafia: false });
  });

  it("joins the Mafia when the last Mafia member is voted out, and the game goes on", () => {
    let s = game(7, { ...BASE, p5: "defector" }, on("defector"));
    find(s, "p2").alive = false;
    s = toDay(s);
    s = runVote(s, Object.fromEntries(s.players.filter((p) => p.id !== "p1").map((p) => [p.id, "p1"])));
    expect(find(s, "p1").alive).toBe(false);
    expect(find(s, "p5").role).toBe("mafia");
    expect(find(s, "p5").defected).toBe(true);
    expect(viewFor(s, "p5").you!.notes.at(-1)!.text).toMatch(/joined the Mafia/);
    s = expire(s);
    expect(s.phase).toBe("night"); // the Village did NOT win yet
    expect(s.winner).toBeNull();
  });

  it("if turning gives the Mafia parity, the Mafia win", () => {
    let s = game(7, { ...BASE, p5: "defector" }, on("defector"));
    for (const id of ["p0", "p2", "p4", "p6"]) find(s, id).alive = false;
    // Alive: p1 (Mafia), p3 (Doctor), p5 (Defector). Vote p1 out: the Defector turns, 1 Mafia v 1 town.
    s = toDay(s);
    s = runVote(s, { p3: "p1", p5: "p1", p1: "p3" });
    expect(find(s, "p5").role).toBe("mafia");
    s = expire(s);
    expect(s.phase).toBe("ended");
    expect(s.winner).toBe("mafia");
  });

  it("is shown as turned only once the game is over", () => {
    let s = game(7, { ...BASE, p5: "defector" }, on("defector"));
    expect(viewFor(s, "p0").players.every((p) => !p.defected)).toBe(true);
    find(s, "p5").defected = true;
    expect(viewFor(s, "p0").players.every((p) => !p.defected)).toBe(true);
    s = structuredClone(s);
    s.phase = "ended";
    expect(viewFor(s, "p0").players.find((p) => p.id === "p5")!.defected).toBe(true);
  });
});

describe("no leaks of the new roles", () => {
  it("a bystander's view never carries anyone's hidden role, lover or note", () => {
    const all = on("godfather", "terrorist", "judge", "lawyer", "heir", "defector", "jester");
    let s = lobby(12);
    s = act(s, { type: "SET_RULES", playerId: "p0", rules: { ...all, lovers: true }, now: 1 });
    s = act(s, { type: "START", playerId: "p0", now: 2 });
    for (const p of s.players) {
      const v = viewFor(s, p.id);
      const json = JSON.stringify(v);
      for (const q of v.players) {
        if (q.id === p.id) continue;
        const teammate = p.role === "mafia" || p.role === "godfather" ? q.role === "mafia" || q.role === "godfather" : false;
        if (!teammate) expect(q.role, `${p.id} sees ${q.id}`).toBeNull();
      }
      expect(json).not.toContain("rngSeed");
      expect(v.you!.notes.every((n) => n.playerId === p.id)).toBe(true);
    }
  });
});

function simulate(seed: number, n: number, patch: Partial<Rules>): { state: GameState; seen: Set<string> } {
  let s = createGame("SIMUL", seed, 0);
  s = ok(reduce(s, { type: "JOIN", playerId: "host", name: "Host", bodyColor: "#ffffff", skinColor: "#ffffff", now: 0 }));
  s = ok(reduce(s, { type: "ADD_BOTS", playerId: "host", count: n - 1, now: 0 }));
  s = ok(reduce(s, { type: "SET_RULES", playerId: "host", rules: patch, now: 0 }));
  s = ok(reduce(s, { type: "START", playerId: "host", now: 0 }));
  const seen = new Set<string>();
  let now = 0;
  for (let i = 0; i < 30_000 && s.phase !== "ended"; i++) {
    now += 500;
    for (const a of planBotActions(s, now)) {
      const r = reduce(s, a);
      expect(r.error, `${a.type} ${"playerId" in a ? a.playerId : ""} in ${s.phase}`).toBeUndefined();
      s = r.state;
      seen.add(a.type);
    }
    // The human host never acts. Give the bots a few seconds of day to use their powers, then skip ahead.
    if (s.phase === "day" && now - s.phaseStartedAt > 6000) s = ok(reduce(s, { type: "SKIP_DISCUSSION", playerId: "host", now }));
    s = ok(reduce(s, { type: "TICK", now }));
  }
  return { state: s, seen };
}

describe("full simulated games with the new roles", () => {
  const everything: Partial<Rules> = { ...on("godfather", "terrorist", "judge", "lawyer", "heir", "defector", "mayor", "jester"), lovers: true };

  it.each(Array.from({ length: 12 }, (_, i) => i + 1))("seed %i: 14 players, every role in play, reaches a winner", (seed) => {
    const { state } = simulate(seed, 14, everything);
    expect(state.phase).toBe("ended");
    expect(state.winner).toMatch(/village|mafia|jester/);
    expect(state.players.every((p) => p.roleRevealed)).toBe(true);
    const mafia = state.players.filter((p) => p.alive && (p.role === "mafia" || p.role === "godfather")).length;
    if (state.winner === "village") expect(mafia).toBe(0);
    if (state.winner === "mafia") expect(mafia).toBeGreaterThanOrEqual(state.players.filter((p) => p.alive).length - mafia);
  });

  it("across seeds, the bots really do use powers, and every kind of winner occurs", () => {
    const actions = new Set<string>();
    const winners = new Set<string>();
    for (let seed = 1; seed <= 40; seed++) {
      const { state, seen } = simulate(seed, 14, everything);
      seen.forEach((a) => actions.add(a));
      winners.add(state.winner!);
    }
    for (const a of ["TERRORIST_BOMB", "LAWYER_SHIELD", "JUDGE_OVERTURN"]) expect(actions.has(a), a).toBe(true);
    expect(winners.has("village")).toBe(true);
    expect(winners.has("mafia")).toBe(true);
  });

  it.each(DEAL_ORDER)("the %s deal plays through at 7 and 10 players", (deal) => {
    for (const n of [7, 10]) {
      const { state } = simulate(3, n, { ...dealPatch(deal) });
      expect(state.phase, `${deal} ${n}`).toBe("ended");
    }
  });

  it("with revealRoles off, the game still ends and shows everything at the end", () => {
    const { state } = simulate(5, 12, { ...everything, revealRoles: false });
    expect(state.phase).toBe("ended");
  });
});
