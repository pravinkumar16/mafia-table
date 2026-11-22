import { describe, expect, it } from "vitest";
import { checkWinner, createGame, mafiaTarget, reduce, tallyVotes } from "../engine";
import { dealRoles, mafiaCount, roleList } from "../roles";
import { createRng } from "../rng";
import { SKIP, type GameState, type Role } from "../types";
import { act, expire, ids, LAYOUT, lobby, ok, startedWith, toNight } from "./helpers";

const count = (roles: Role[], r: Role) => roles.filter((x) => x === r).length;

describe("role distribution", () => {
  it.each([
    [7, 2],
    [8, 2],
    [9, 3],
    [12, 3],
    [13, 3],
    [16, 4],
    [20, 5],
  ])("%i players -> %i mafia, 1 doctor, 1 detective, rest villagers", (n, mafia) => {
    const roles = roleList(n);
    expect(roles).toHaveLength(n);
    expect(mafiaCount(n)).toBe(mafia);
    expect(count(roles, "mafia")).toBe(mafia);
    expect(count(roles, "doctor")).toBe(1);
    expect(count(roles, "detective")).toBe(1);
    expect(count(roles, "villager")).toBe(n - mafia - 2);
  });

  it("refuses fewer than 7 players", () => {
    expect(() => roleList(6)).toThrow();
    const r = reduce(lobby(6), { type: "START", playerId: "p0", now: 0 });
    expect(r.error).toMatch(/7 or more/);
    expect(r.state.phase).toBe("lobby");
  });

  it("deals every role to exactly one player, and the deal varies with the seed", () => {
    const a = dealRoles(ids(9), createRng(1));
    const b = dealRoles(ids(9), createRng(2));
    expect(Object.values(a).sort()).toEqual(roleList(9).sort());
    expect(a).not.toEqual(b);
  });

  it("only the host can start, and START deals roles to everyone", () => {
    const s = lobby(7);
    expect(reduce(s, { type: "START", playerId: "p3", now: 0 }).error).toMatch(/host/);
    const started = ok(reduce(s, { type: "START", playerId: "p0", now: 0 }));
    expect(started.phase).toBe("roleReveal");
    expect(started.players.every((p) => p.role)).toBe(true);
  });
});

describe("night", () => {
  it("doctor protecting the mafia's target saves them", () => {
    let s = toNight(startedWith(7, LAYOUT));
    expect(s.phase).toBe("night");
    expect(s.night!.step).toBe("mafia");
    s = act(s, { type: "NIGHT_ACTION", playerId: "p1", targetId: "p5", now: 2000 });
    s = act(s, { type: "NIGHT_ACTION", playerId: "p2", targetId: "p5", now: 2000 });
    expect(s.night!.step).toBe("doctor");
    s = act(s, { type: "NIGHT_ACTION", playerId: "p3", targetId: "p5", now: 3000 });
    s = act(s, { type: "NIGHT_ACTION", playerId: "p4", targetId: "p1", now: 4000 });
    expect(s.phase).toBe("morning");
    expect(s.morning).toEqual({ round: 1, killedId: null, saved: true, alsoDied: [] });
    expect(s.players.every((p) => p.alive)).toBe(true);
    expect(s.narration.event).toBe("morningSaved");
  });

  it("an unprotected target dies and their role is revealed", () => {
    let s = toNight(startedWith(7, LAYOUT));
    s = act(s, { type: "NIGHT_ACTION", playerId: "p1", targetId: "p5", now: 2000 });
    s = act(s, { type: "NIGHT_ACTION", playerId: "p2", targetId: "p5", now: 2000 });
    s = act(s, { type: "NIGHT_ACTION", playerId: "p3", targetId: "p6", now: 3000 });
    s = act(s, { type: "NIGHT_ACTION", playerId: "p4", targetId: "p1", now: 4000 });
    const victim = s.players.find((p) => p.id === "p5")!;
    expect(victim.alive).toBe(false);
    expect(victim.roleRevealed).toBe(true);
    expect(s.morning!.killedId).toBe("p5");
  });

  it("doctor cannot protect the same player two nights in a row", () => {
    let s = toNight(startedWith(7, LAYOUT));
    s = act(s, { type: "NIGHT_ACTION", playerId: "p1", targetId: "p5", now: 1 });
    s = act(s, { type: "NIGHT_ACTION", playerId: "p2", targetId: "p5", now: 1 });
    s = act(s, { type: "NIGHT_ACTION", playerId: "p3", targetId: "p5", now: 1 });
    s = act(s, { type: "NIGHT_ACTION", playerId: "p4", targetId: "p6", now: 1 });
    // morning -> day -> vote (everyone skips) -> result -> night 2
    s = expire(s);
    s = expire(s);
    for (const p of s.players.filter((q) => q.alive)) s = act(s, { type: "VOTE", playerId: p.id, choice: SKIP, now: s.phaseStartedAt });
    s = expire(s);
    expect(s.phase).toBe("night");
    s = act(s, { type: "NIGHT_ACTION", playerId: "p1", targetId: "p6", now: s.phaseStartedAt });
    s = act(s, { type: "NIGHT_ACTION", playerId: "p2", targetId: "p6", now: s.phaseStartedAt });
    const r = reduce(s, { type: "NIGHT_ACTION", playerId: "p3", targetId: "p5", now: s.phaseStartedAt });
    expect(r.error).toMatch(/last night/);
    expect(ok(reduce(s, { type: "NIGHT_ACTION", playerId: "p3", targetId: "p3", now: s.phaseStartedAt })).night!.step).toBe("detective");
  });

  it("detective learns Mafia / Not Mafia", () => {
    let s = toNight(startedWith(7, LAYOUT));
    s = act(s, { type: "NIGHT_ACTION", playerId: "p1", targetId: "p0", now: 1 });
    s = act(s, { type: "NIGHT_ACTION", playerId: "p2", targetId: "p0", now: 1 });
    s = act(s, { type: "NIGHT_ACTION", playerId: "p3", targetId: "p0", now: 1 });
    expect(s.night!.step).toBe("detective");
    s = act(s, { type: "NIGHT_ACTION", playerId: "p4", targetId: "p2", now: 1 });
    expect(s.detectiveResults).toEqual([{ round: 1, targetId: "p2", isMafia: true }]);

    let t = toNight(startedWith(7, LAYOUT));
    t = expire(expire(t)); // mafia and doctor time out
    t = act(t, { type: "NIGHT_ACTION", playerId: "p4", targetId: "p6", now: t.phaseStartedAt });
    expect(t.detectiveResults[0].isMafia).toBe(false);
  });

  it("rejects out-of-turn and invalid actions", () => {
    const s = toNight(startedWith(7, LAYOUT));
    expect(reduce(s, { type: "NIGHT_ACTION", playerId: "p3", targetId: "p5", now: 1 }).error).toMatch(/turn/);
    expect(reduce(s, { type: "NIGHT_ACTION", playerId: "p1", targetId: "p2", now: 1 }).error).toMatch(/can't pick/);
    expect(reduce(s, { type: "NIGHT_ACTION", playerId: "p0", targetId: "p5", now: 1 }).error).toBeTruthy();
  });

  it("mafia majority wins and ties break at random among the tied", () => {
    expect(mafiaTarget({ a: "x", b: "x", c: "y" }, createRng(1))).toBe("x");
    const seen = new Set<string>();
    for (let seed = 0; seed < 40; seed++) seen.add(mafiaTarget({ a: "x", b: "y" }, createRng(seed))!);
    expect([...seen].sort()).toEqual(["x", "y"]);
    expect(mafiaTarget({}, createRng(1))).toBeNull();
  });

  it("each step times out after 30 s and absent actors are skipped", () => {
    let s = toNight(startedWith(7, LAYOUT), 1000);
    expect(s.phaseEndsAt).toBe(1000 + 30_000);
    s = expire(s);
    expect(s.night!.step).toBe("doctor");
    s = expire(s);
    s = expire(s);
    expect(s.phase).toBe("morning");
    expect(s.morning!.killedId).toBeNull();
  });
});

describe("day vote", () => {
  function atVote(): GameState {
    let s = toNight(startedWith(7, LAYOUT));
    s = expire(expire(expire(s))); // quiet night
    s = expire(s); // morning -> day
    expect(s.phase).toBe("day");
    s = act(s, { type: "SKIP_DISCUSSION", playerId: "p0", now: s.phaseStartedAt });
    expect(s.phase).toBe("vote");
    return s;
  }
  const castAll = (s: GameState, choices: Record<string, string>) => {
    for (const [id, choice] of Object.entries(choices)) s = act(s, { type: "VOTE", playerId: id, choice, now: s.phaseStartedAt });
    return s;
  };

  it("tallyVotes: most votes is out; top tie or skip majority means nobody", () => {
    expect(tallyVotes({ a: "x", b: "x", c: "y" }).eliminatedId).toBe("x");
    expect(tallyVotes({ a: "x", b: "y" }).eliminatedId).toBeNull();
    expect(tallyVotes({ a: SKIP, b: SKIP, c: "x" }).eliminatedId).toBeNull();
    expect(tallyVotes({ a: SKIP, b: "x" }).eliminatedId).toBeNull();
    expect(tallyVotes({}).eliminatedId).toBeNull();
  });

  it("only the host can skip discussion", () => {
    let s = toNight(startedWith(7, LAYOUT));
    s = expire(expire(expire(expire(s))));
    expect(reduce(s, { type: "SKIP_DISCUSSION", playerId: "p4", now: 1 }).error).toMatch(/host/);
  });

  it("a tied vote eliminates nobody", () => {
    const s = castAll(atVote(), { p0: "p1", p1: "p0", p2: "p0", p3: "p1", p4: "p1", p5: "p0", p6: SKIP });
    expect(s.phase).toBe("voteResult");
    expect(s.voteReport!.eliminatedId).toBeNull();
    expect(s.players.every((p) => p.alive)).toBe(true);
  });

  it("the most-voted player is eliminated and revealed", () => {
    const s = castAll(atVote(), { p0: "p1", p1: "p0", p2: "p0", p3: "p1", p4: "p1", p5: "p1", p6: SKIP });
    expect(s.voteReport!.eliminatedId).toBe("p1");
    const p1 = s.players.find((p) => p.id === "p1")!;
    expect(p1.alive).toBe(false);
    expect(p1.roleRevealed).toBe(true);
  });

  it("ghosts and self-votes are refused", () => {
    const s = atVote();
    expect(reduce(s, { type: "VOTE", playerId: "p0", choice: "p0", now: 1 }).error).toMatch(/yourself/);
  });
});

describe("win conditions", () => {
  it("village wins when every mafia member is dead", () => {
    let s = startedWith(7, LAYOUT);
    s = structuredClone(s);
    s.players.find((p) => p.id === "p1")!.alive = false;
    s = toNight(s);
    // Mafia p2 kills nobody; vote p2 out.
    s = expire(expire(expire(s)));
    s = expire(s);
    s = act(s, { type: "SKIP_DISCUSSION", playerId: "p0", now: s.phaseStartedAt });
    for (const p of s.players.filter((q) => q.alive && q.id !== "p2")) s = act(s, { type: "VOTE", playerId: p.id, choice: "p2", now: 1 });
    s = act(s, { type: "VOTE", playerId: "p2", choice: "p0", now: 1 });
    s = expire(s);
    expect(s.phase).toBe("ended");
    expect(s.winner).toBe("village");
    expect(s.players.every((p) => p.roleRevealed)).toBe(true);
  });

  it("mafia wins when they equal the living non-mafia", () => {
    let s = structuredClone(startedWith(7, LAYOUT));
    // Leave 2 mafia + 3 others; one night kill makes it 2 v 2.
    for (const id of ["p5", "p6"]) s.players.find((p) => p.id === id)!.alive = false;
    s = toNight(s);
    s = act(s, { type: "NIGHT_ACTION", playerId: "p1", targetId: "p0", now: 1 });
    s = act(s, { type: "NIGHT_ACTION", playerId: "p2", targetId: "p0", now: 1 });
    s = act(s, { type: "NIGHT_ACTION", playerId: "p3", targetId: "p3", now: 1 });
    s = act(s, { type: "NIGHT_ACTION", playerId: "p4", targetId: "p1", now: 1 });
    expect(checkWinner(s)).toBe("mafia");
    s = expire(s); // morning ends -> win check
    expect(s.phase).toBe("ended");
    expect(s.winner).toBe("mafia");
  });

  it("play again keeps the table and resets roles", () => {
    let s = structuredClone(startedWith(7, LAYOUT));
    for (const id of ["p1", "p2"]) s.players.find((p) => p.id === id)!.alive = false;
    s = toNight(s);
    expect(s.players.length).toBe(7);
    s = expire(expire(s));
    s = expire(s);
    expect(s.phase).toBe("ended");
    s = act(s, { type: "PLAY_AGAIN", playerId: "p0", now: 5 });
    expect(s.phase).toBe("lobby");
    expect(s.players).toHaveLength(7);
    expect(s.players.every((p) => p.alive && p.role === null)).toBe(true);
  });
});

describe("seats, host and reconnect", () => {
  it("first player is host; rejoining keeps the same seat", () => {
    let s = lobby(3);
    expect(s.hostId).toBe("p0");
    const seat = s.players.find((p) => p.id === "p1")!.seat;
    s = act(s, { type: "DISCONNECT", playerId: "p1", now: 10 });
    s = act(s, { type: "JOIN", playerId: "p1", name: "P1", bodyColor: "#000000", skinColor: "#000000", now: 20 });
    expect(s.players.find((p) => p.id === "p1")!.seat).toBe(seat);
    expect(s.players).toHaveLength(3);
  });

  it("reconnecting mid-game restores the role", () => {
    let s = toNight(startedWith(7, LAYOUT));
    s = act(s, { type: "DISCONNECT", playerId: "p4", now: 2 });
    s = act(s, { type: "JOIN", playerId: "p4", name: "x", bodyColor: "#000000", skinColor: "#000000", now: 3 });
    const p4 = s.players.find((p) => p.id === "p4")!;
    expect(p4.role).toBe("detective");
    expect(p4.connected).toBe(true);
  });

  it("new players cannot join a game in progress, or a full table", () => {
    const s = startedWith(7, LAYOUT);
    expect(reduce(s, { type: "JOIN", playerId: "new", name: "N", bodyColor: "#000000", skinColor: "#000000", now: 1 }).error).toMatch(/in progress/);
    const full = lobby(16);
    expect(reduce(full, { type: "JOIN", playerId: "new", name: "N", bodyColor: "#000000", skinColor: "#000000", now: 1 }).error).toMatch(/full/);
  });

  it("host leaving hands host to the next player", () => {
    let s = act(lobby(3), { type: "LEAVE", playerId: "p0", now: 1 });
    expect(s.hostId).toBe("p1");
    s = act(s, { type: "DISCONNECT", playerId: "p1", now: 1000 });
    s = act(s, { type: "TICK", now: 1000 + 5000 });
    expect(s.hostId).toBe("p1"); // still in the grace period
    s = act(s, { type: "TICK", now: 1000 + 21_000 });
    expect(s.hostId).toBe("p2");
  });

  it("is deterministic", () => {
    const run = () => toNight(ok(reduce(lobby(9, 7), { type: "START", playerId: "p0", now: 0 })));
    expect(run()).toEqual(run());
  });

  it("does not mutate the input state", () => {
    const s = lobby(7);
    const snapshot = structuredClone(s);
    reduce(s, { type: "START", playerId: "p0", now: 0 });
    expect(s).toEqual(snapshot);
  });

  it("createGame starts in the lobby", () => {
    expect(createGame("XYZAB", 1, 0).phase).toBe("lobby");
  });
});
