import { describe, expect, it } from "vitest";
import { Table, type Outbox } from "./table";
import type { ServerMessage } from "../lib/protocol";
import type { PlayerView } from "../game";

const SECRET_A = "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa";
const SECRET_B = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";

function makeTable(botsAllowed = true) {
  let n = 0;
  return new Table("ABCDE", { seed: 123, now: 0, botsAllowed, newId: () => `id${++n}` });
}

class Harness {
  table = makeTable();
  log = new Map<string, ServerMessage[]>();
  now = 0;
  private push(out: Outbox) {
    for (const [cid, m] of out) this.log.set(cid, [...(this.log.get(cid) ?? []), m]);
  }
  connect(cid: string, secret: string | null) {
    const out: Outbox = [];
    const ok = this.table.connect(cid, secret, this.now, out);
    this.table.flush(this.now, out, true);
    this.push(out);
    return ok;
  }
  send(cid: string, msg: object) {
    const out: Outbox = [];
    this.now += 100; // stay under the rate limit
    this.table.message(cid, JSON.stringify(msg), this.now, out);
    this.table.flush(this.now, out);
    this.push(out);
    return out.filter(([c]) => c === cid).map(([, m]) => m);
  }
  advance(ms: number) {
    const out: Outbox = [];
    this.now += ms;
    this.table.tick(this.now);
    this.table.flush(this.now, out);
    this.push(out);
  }
  views(cid: string): PlayerView[] {
    return (this.log.get(cid) ?? []).flatMap((m) => (m.t === "state" ? [m.view] : []));
  }
  last(cid: string) {
    const v = this.views(cid);
    return v[v.length - 1];
  }
}

describe("PartyKit table", () => {
  it("refuses connections without a valid secret", () => {
    const h = new Harness();
    expect(h.connect("c1", null)).toBe(false);
    expect(h.connect("c2", "short")).toBe(false);
  });

  it("first player is host, and actor ids come from the socket, not the message", () => {
    const h = new Harness();
    h.connect("a", SECRET_A);
    h.send("a", { t: "join", name: "Ada", bodyColor: "#ff0000", skinColor: "#00ff00" });
    h.connect("b", SECRET_B);
    h.send("b", { t: "join", name: "Bo", bodyColor: "#ff0000", skinColor: "#00ff00" });
    expect(h.last("a").hostId).toBe(h.last("a").you!.id);
    // B tries to start the game pretending to be A: ignored, B is not host.
    const replies = h.send("b", { t: "start", playerId: h.last("a").you!.id });
    expect(replies.some((m) => m.t === "error")).toBe(true);
  });

  it("rejects malformed messages and disabled bots", () => {
    const h = new Harness();
    h.table = makeTable(false);
    h.connect("a", SECRET_A);
    expect(h.send("a", { t: "nope" })[0]).toMatchObject({ t: "error" });
    h.send("a", { t: "join", name: "Ada", bodyColor: "#ff0000", skinColor: "#00ff00" });
    expect(h.send("a", { t: "addBots", count: 6 })[0]).toMatchObject({ t: "error", message: expect.stringMatching(/disabled/) });
  });

  it("reconnecting with the same secret restores the seat and role", () => {
    const h = new Harness();
    h.connect("a", SECRET_A);
    h.send("a", { t: "join", name: "Ada", bodyColor: "#ff0000", skinColor: "#00ff00" });
    h.send("a", { t: "addBots", count: 6 });
    h.send("a", { t: "start" });
    const before = h.last("a").you!;
    h.table.disconnect("a", h.now);
    h.connect("a2", SECRET_A);
    const after = h.last("a2").you!;
    expect(after.id).toBe(before.id);
    expect(after.role).toBe(before.role);
    expect(h.table.playerIdFor(SECRET_A)).toBe(before.id);
  });

  it("over a full bot game, a human socket never receives hidden roles, night actions or early vote targets", () => {
    const h = new Harness();
    h.connect("a", SECRET_A);
    h.send("a", { t: "join", name: "Ada", bodyColor: "#ff0000", skinColor: "#00ff00" });
    h.connect("spy", SECRET_B); // connected but never seated
    h.send("a", { t: "addBots", count: 8 });
    h.send("a", { t: "start" });
    let guard = 0;
    while (h.table.state.phase !== "ended" && guard++ < 5000) {
      if (h.table.state.phase === "day") h.send("a", { t: "skipDiscussion" });
      h.advance(500);
    }
    expect(h.table.state.phase).toBe("ended");

    const me = h.last("a").you!.id;
    const myRole = h.table.state.players.find((p) => p.id === me)!.role;
    const truth = new Map(h.table.state.players.map((p) => [p.id, p.role]));

    for (const raw of h.log.get("a")!) {
      const json = JSON.stringify(raw);
      expect(json).not.toContain(SECRET_A);
      expect(json).not.toContain(SECRET_B);
      if (raw.t !== "state") continue;
      const v = raw.view;
      for (const p of v.players) {
        if (p.id === me || p.roleRevealed) continue;
        if (myRole === "mafia" && truth.get(p.id) === "mafia") continue;
        expect(p.role, `role of ${p.id} leaked in ${v.phase}`).toBeNull();
      }
      if (v.you && myRole !== "mafia") expect(v.you.mafiaVotes).toEqual({});
      if (v.you && myRole !== "detective") expect(v.you.detectiveResults).toEqual([]);
      if (v.phase === "vote") expect(v.voteReport).toBeNull();
      expect(json).not.toContain("doctorTarget");
      expect(json).not.toContain("rngSeed");
    }
    // An unseated spectator never sees any unrevealed role.
    for (const v of h.views("spy")) for (const p of v.players) if (!p.roleRevealed) expect(p.role).toBeNull();
    // Mafia chat never reaches a non-mafia, ghost chat never reaches the living.
    for (const v of h.views("spy")) {
      expect(v.chat.mafia).toBeUndefined();
      expect(v.chat.ghost).toBeUndefined();
    }
  });
});
