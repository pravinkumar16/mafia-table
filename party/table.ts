// Runtime-agnostic room logic. The PartyKit adapter (index.ts) feeds it
// connections, messages and clock ticks, and sends whatever it emits.
// Every state message is built per connection with viewFor(), so a socket
// only ever receives the filtered view of the player it belongs to.

import { createGame, findPlayer, migrateState, planBotActions, reduce, viewFor, type Action, type GameState } from "../game";
import { isValidSecret, parseClientMessage, type ServerMessage } from "../lib/protocol";

export type Outbox = Array<[connId: string, msg: ServerMessage]>;

export interface SavedTable {
  state: GameState;
  secrets: Record<string, string>;
}

const WAVE_PHASES = new Set(["lobby", "morning", "day", "vote", "voteResult", "ended"]);

export class Table {
  state: GameState;
  /** reconnect secret -> public player id. Never sent to clients. */
  secrets: Record<string, string>;
  private conns = new Map<string, string>(); // connId -> secret
  private lastSent = new Map<string, string>(); // connId -> last view JSON
  private rate = new Map<string, { windowStart: number; count: number }>();
  dirty = false;

  constructor(
    code: string,
    opts: { seed: number; now: number; botsAllowed: boolean; saved?: SavedTable | null; newId: () => string },
  ) {
    this.botsAllowed = opts.botsAllowed;
    this.newId = opts.newId;
    this.state = opts.saved?.state ? migrateState(opts.saved.state) : createGame(code, opts.seed, opts.now);
    this.secrets = opts.saved?.secrets ?? {};
  }
  readonly botsAllowed: boolean;
  private readonly newId: () => string;

  save(): SavedTable {
    return { state: this.state, secrets: this.secrets };
  }

  get connectionCount() {
    return this.conns.size;
  }

  playerIdFor(secret: string | null | undefined): string | null {
    if (!secret) return null;
    const id = this.secrets[secret];
    return id && findPlayer(this.state, id) ? id : null;
  }

  private dispatch(action: Action): string | undefined {
    const r = reduce(this.state, action);
    if (r.error) return r.error;
    if (r.state !== this.state) {
      this.state = r.state;
      this.dirty = true;
    }
    return undefined;
  }

  /** Returns false if the connection should be refused. */
  connect(connId: string, secret: string | null, now: number, out: Outbox): boolean {
    if (!isValidSecret(secret)) {
      out.push([connId, { t: "error", message: "Missing or invalid player id." }]);
      return false;
    }
    this.conns.set(connId, secret);
    const pid = this.playerIdFor(secret);
    if (pid) this.dispatch({ type: "CONNECT", playerId: pid, now });
    out.push([connId, { t: "welcome", playerId: pid, botsAllowed: this.botsAllowed }]);
    this.dirty = true;
    return true;
  }

  disconnect(connId: string, now: number) {
    const secret = this.conns.get(connId);
    this.conns.delete(connId);
    this.lastSent.delete(connId);
    this.rate.delete(connId);
    if (!secret) return;
    const stillHere = [...this.conns.values()].includes(secret);
    const pid = this.playerIdFor(secret);
    if (pid && !stillHere) this.dispatch({ type: "DISCONNECT", playerId: pid, now });
  }

  private rateLimited(connId: string, now: number): boolean {
    const r = this.rate.get(connId) ?? { windowStart: now, count: 0 };
    if (now - r.windowStart > 1000) {
      r.windowStart = now;
      r.count = 0;
    }
    r.count++;
    this.rate.set(connId, r);
    return r.count > 15;
  }

  message(connId: string, raw: unknown, now: number, out: Outbox) {
    const secret = this.conns.get(connId);
    if (!secret) return;
    if (this.rateLimited(connId, now)) return;
    const msg = parseClientMessage(raw);
    if (!msg) {
      out.push([connId, { t: "error", message: "Malformed message." }]);
      return;
    }
    let pid = this.playerIdFor(secret);
    const fail = (message?: string) => message && out.push([connId, { t: "error", message }]);

    if (msg.t === "join") {
      const id = pid ?? this.secrets[secret] ?? this.newId();
      const err = this.dispatch({ type: "JOIN", playerId: id, name: msg.name, bodyColor: msg.bodyColor, skinColor: msg.skinColor, now });
      if (err) return fail(err);
      this.secrets[secret] = id;
      this.dirty = true;
      // Tell every tab using this secret who they are now.
      for (const [cid, sec] of this.conns) if (sec === secret) out.push([cid, { t: "welcome", playerId: id, botsAllowed: this.botsAllowed }]);
      return;
    }

    if (!pid) return fail("Take a seat first.");
    // The actor is always derived from the connection, never from the message.
    switch (msg.t) {
      case "leave":
        fail(this.dispatch({ type: "LEAVE", playerId: pid, now }));
        if (this.state.phase === "lobby") delete this.secrets[secret];
        for (const [cid, sec] of this.conns) if (sec === secret) out.push([cid, { t: "welcome", playerId: this.playerIdFor(secret), botsAllowed: this.botsAllowed }]);
        return;
      case "setRules":
        return fail(this.dispatch({ type: "SET_RULES", playerId: pid, rules: msg.rules, now }));
      case "start":
        return fail(this.dispatch({ type: "START", playerId: pid, now }));
      case "addBots":
        if (!this.botsAllowed) return fail("Bots are disabled on this server.");
        return fail(this.dispatch({ type: "ADD_BOTS", playerId: pid, count: msg.count, now }));
      case "ready":
        return fail(this.dispatch({ type: "READY", playerId: pid, now }));
      case "night":
        return fail(this.dispatch({ type: "NIGHT_ACTION", playerId: pid, targetId: msg.targetId, now }));
      case "vote":
        return fail(this.dispatch({ type: "VOTE", playerId: pid, choice: msg.choice, now }));
      case "watch":
        return fail(this.dispatch({ type: "NIGHT_WATCH", playerId: pid, now }));
      case "haunt":
        return fail(this.dispatch({ type: "GHOST_HAUNT", playerId: pid, targetId: msg.targetId, now }));
      case "bomb":
        return fail(this.dispatch({ type: "TERRORIST_BOMB", playerId: pid, targetId: msg.targetId, now }));
      case "overturn":
        return fail(this.dispatch({ type: "JUDGE_OVERTURN", playerId: pid, now }));
      case "shield":
        return fail(this.dispatch({ type: "LAWYER_SHIELD", playerId: pid, targetId: msg.targetId, now }));
      case "skipDiscussion":
        return fail(this.dispatch({ type: "SKIP_DISCUSSION", playerId: pid, now }));
      case "playAgain":
        return fail(this.dispatch({ type: "PLAY_AGAIN", playerId: pid, now }));
      case "chat":
        return fail(this.dispatch({ type: "CHAT", playerId: pid, channel: msg.channel, text: msg.text, now }));
      case "wave": {
        const from = findPlayer(this.state, pid);
        const target = findPlayer(this.state, msg.targetId);
        if (!from || !target || !from.alive || !WAVE_PHASES.has(this.state.phase)) return;
        for (const cid of this.conns.keys()) out.push([cid, { t: "wave", fromId: pid, targetId: target.id }]);
        return;
      }
    }
  }

  tick(now: number) {
    for (const a of planBotActions(this.state, now)) this.dispatch(a);
    this.dispatch({ type: "TICK", now });
  }

  /** Per-connection filtered views, only for sockets whose view changed. */
  flush(now: number, out: Outbox, force = false) {
    if (!this.dirty && !force) return;
    this.dirty = false;
    for (const [cid, secret] of this.conns) {
      const view = viewFor(this.state, this.playerIdFor(secret));
      const json = JSON.stringify(view);
      if (!force && this.lastSent.get(cid) === json) continue;
      this.lastSent.set(cid, json);
      out.push([cid, { t: "state", view, serverNow: now }]);
    }
  }
}
