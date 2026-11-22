import { describe, expect, it } from "vitest";
import { createGame, reduce } from "../engine";
import { planBotActions } from "../bots";
import { viewFor } from "../view";
import { SKIP, type GameState } from "../types";
import { act, expire, LAYOUT, ok, startedWith, toNight } from "./helpers";

describe("filtered views never leak hidden information", () => {
  it("a villager sees only their own role", () => {
    const s = startedWith(7, LAYOUT);
    const v = viewFor(s, "p0");
    expect(v.you!.role).toBe("villager");
    for (const p of v.players.filter((q) => q.id !== "p0")) expect(p.role).toBeNull();
    const json = JSON.stringify(v);
    expect(json).not.toContain('"role":"mafia"');
    expect(json).not.toContain('"role":"doctor"');
    expect(json).not.toContain('"role":"detective"');
  });

  it("mafia see each other but not the doctor or detective", () => {
    const v = viewFor(startedWith(7, LAYOUT), "p1");
    const roleOf = (id: string) => v.players.find((p) => p.id === id)!.role;
    expect(roleOf("p2")).toBe("mafia");
    expect(roleOf("p3")).toBeNull();
    expect(roleOf("p4")).toBeNull();
    expect(v.you!.mafiaTeam.sort()).toEqual(["p1", "p2"]);
  });

  it("night actions are only visible to the actors who own them", () => {
    let s = toNight(startedWith(7, LAYOUT));
    s = act(s, { type: "NIGHT_ACTION", playerId: "p1", targetId: "p5", now: 1 });
    expect(viewFor(s, "p2").you!.mafiaVotes).toEqual({ p1: "p5" });
    for (const id of ["p0", "p3", "p4", "p5"]) {
      const json = JSON.stringify(viewFor(s, id));
      expect(json).not.toContain("p5\"}"); // no {p1: "p5"}
      expect(viewFor(s, id).you!.mafiaVotes).toEqual({});
    }
    s = act(s, { type: "NIGHT_ACTION", playerId: "p2", targetId: "p5", now: 1 });
    s = act(s, { type: "NIGHT_ACTION", playerId: "p3", targetId: "p6", now: 1 });
    expect(viewFor(s, "p3").you!.myPick).toBeNull(); // step moved on
    s = act(s, { type: "NIGHT_ACTION", playerId: "p4", targetId: "p1", now: 1 });
    expect(viewFor(s, "p4").you!.detectiveResults).toEqual([{ round: 1, targetId: "p1", isMafia: true }]);
    for (const id of ["p0", "p1", "p2", "p3"]) expect(viewFor(s, id).you!.detectiveResults).toEqual([]);
    // Nobody learns the doctor's pick.
    for (const id of ["p0", "p1", "p2", "p3", "p4"]) expect(JSON.stringify(viewFor(s, id))).not.toContain("doctorTarget");
  });

  it("vote targets stay hidden until the vote is over", () => {
    let s = toNight(startedWith(7, LAYOUT));
    s = expire(expire(expire(expire(s))));
    s = act(s, { type: "SKIP_DISCUSSION", playerId: "p0", now: s.phaseStartedAt });
    s = act(s, { type: "VOTE", playerId: "p0", choice: "p1", now: 1 });
    const other = viewFor(s, "p5");
    expect(other.voteReport).toBeNull();
    expect(other.votesCast).toBe(1);
    expect(other.players.find((p) => p.id === "p0")!.hasVoted).toBe(true);
    expect(other.you!.myVote).toBeNull();
    expect(viewFor(s, "p0").you!.myVote).toBe("p1");
    for (const id of ["p1", "p2", "p3", "p4", "p5", "p6"]) s = act(s, { type: "VOTE", playerId: id, choice: SKIP, now: 1 });
    expect(viewFor(s, "p5").voteReport!.ballots.p0).toBe("p1");
  });

  it("chat channels are enforced", () => {
    let s = toNight(startedWith(7, LAYOUT));
    expect(reduce(s, { type: "CHAT", playerId: "p0", channel: "public", text: "hi", now: 1 }).error).toBeTruthy();
    expect(reduce(s, { type: "CHAT", playerId: "p0", channel: "mafia", text: "hi", now: 1 }).error).toBeTruthy();
    s = act(s, { type: "CHAT", playerId: "p1", channel: "mafia", text: "go for p5", now: 1 });
    expect(viewFor(s, "p2").chat.mafia).toHaveLength(1);
    expect(viewFor(s, "p0").chat.mafia).toBeUndefined();
    expect(viewFor(s, "p0").chat.ghost).toBeUndefined();
    // p5 dies; becomes a ghost
    s = act(s, { type: "NIGHT_ACTION", playerId: "p1", targetId: "p5", now: 1 });
    s = act(s, { type: "NIGHT_ACTION", playerId: "p2", targetId: "p5", now: 1 });
    s = expire(expire(s));
    expect(s.phase).toBe("morning");
    expect(reduce(s, { type: "CHAT", playerId: "p5", channel: "public", text: "it was p1!", now: 1 }).error).toBeTruthy();
    s = act(s, { type: "CHAT", playerId: "p5", channel: "ghost", text: "boo", now: 1 });
    expect(viewFor(s, "p5").chat.ghost).toHaveLength(1);
    expect(viewFor(s, "p0").chat.ghost).toBeUndefined();
    s = act(s, { type: "CHAT", playerId: "p0", channel: "public", text: "morning all", now: 1 });
    expect(viewFor(s, "p5").chat.public).toHaveLength(1);
  });

  it("a ghost has no night actions or vote", () => {
    let s = toNight(startedWith(7, LAYOUT));
    s = act(s, { type: "NIGHT_ACTION", playerId: "p1", targetId: "p3", now: 1 });
    s = act(s, { type: "NIGHT_ACTION", playerId: "p2", targetId: "p3", now: 1 });
    // doctor p3 picks someone else, then dies
    s = act(s, { type: "NIGHT_ACTION", playerId: "p3", targetId: "p0", now: 1 });
    s = expire(s); // detective times out -> morning
    s = expire(s); // -> day
    s = act(s, { type: "SKIP_DISCUSSION", playerId: "p0", now: 1 });
    expect(reduce(s, { type: "VOTE", playerId: "p3", choice: SKIP, now: 1 }).error).toMatch(/Ghosts/);
  });
});

function simulate(seed: number, botCount: number): { state: GameState; rounds: number; steps: number } {
  let s = createGame("SIMUL", seed, 0);
  s = ok(reduce(s, { type: "JOIN", playerId: "host", name: "Host", bodyColor: "#ffffff", skinColor: "#ffffff", now: 0 }));
  s = ok(reduce(s, { type: "ADD_BOTS", playerId: "host", count: botCount, now: 0 }));
  s = ok(reduce(s, { type: "START", playerId: "host", now: 0 }));
  // The human host idles: they never act, and get skipped by every timer.
  let now = 0;
  let steps = 0;
  while (s.phase !== "ended" && steps < 20_000) {
    now += 500;
    steps++;
    for (const a of planBotActions(s, now)) {
      const r = reduce(s, a);
      expect(r.error, `${a.type} by ${"playerId" in a ? a.playerId : ""}`).toBeUndefined();
      s = r.state;
    }
    s = ok(reduce(s, { type: "TICK", now }));
  }
  return { state: s, rounds: s.round, steps };
}

describe("full simulated game with bots", () => {
  it.each([1, 2, 3, 4, 5, 6, 7, 8, 9, 10])("seed %i: 7-player game reaches a winner", (seed) => {
    const { state } = simulate(seed, 6);
    expect(state.phase).toBe("ended");
    expect(state.winner).toMatch(/village|mafia/);
    expect(state.players.every((p) => p.roleRevealed)).toBe(true);
    const alive = state.players.filter((p) => p.alive);
    const mafia = alive.filter((p) => p.role === "mafia").length;
    if (state.winner === "village") expect(mafia).toBe(0);
    else expect(mafia).toBeGreaterThanOrEqual(alive.length - mafia);
  });

  it("a 13-player game reaches a winner too", () => {
    const { state } = simulate(99, 12);
    expect(state.players.filter((p) => p.role === "mafia")).toHaveLength(3);
    expect(state.phase).toBe("ended");
  });

  it("both sides win across seeds", () => {
    const winners = new Set<string>();
    for (let seed = 1; seed <= 30; seed++) winners.add(simulate(seed, 7).state.winner!);
    expect(winners).toEqual(new Set(["village", "mafia"]));
  });
});
