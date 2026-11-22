import type * as Party from "partykit/server";
import { Table, type Outbox, type SavedTable } from "./table";
import { ROOM_CODE_RE } from "../lib/protocol";

const STORAGE_KEY = "table";
const TICK_MS = 500;

export default class TableServer implements Party.Server {
  readonly options: Party.ServerOptions = { hibernate: false };
  private table!: Table;
  private timer: ReturnType<typeof setInterval> | null = null;
  private saving: Promise<void> = Promise.resolve();

  constructor(readonly room: Party.Room) {}

  async onStart() {
    const saved = (await this.room.storage.get<SavedTable>(STORAGE_KEY)) ?? null;
    const seed = crypto.getRandomValues(new Uint32Array(1))[0];
    this.table = new Table(this.room.id.toUpperCase(), {
      seed,
      now: Date.now(),
      botsAllowed: this.room.env.ALLOW_BOTS === "true",
      saved,
      newId: () => crypto.randomUUID().slice(0, 12),
    });
  }

  onConnect(conn: Party.Connection, ctx: Party.ConnectionContext) {
    if (!ROOM_CODE_RE.test(this.room.id.toUpperCase())) {
      conn.send(JSON.stringify({ t: "error", message: "That table code isn't valid." }));
      conn.close(4000, "bad room");
      return;
    }
    const secret = new URL(ctx.request.url).searchParams.get("secret");
    const out: Outbox = [];
    const accepted = this.table.connect(conn.id, secret, Date.now(), out);
    this.send(out);
    if (!accepted) {
      conn.close(4001, "bad secret");
      return;
    }
    this.flush(true);
    this.ensureTimer();
  }

  onMessage(message: string | ArrayBuffer | ArrayBufferView, sender: Party.Connection) {
    const out: Outbox = [];
    this.table.message(sender.id, typeof message === "string" ? message : null, Date.now(), out);
    this.send(out);
    this.flush();
  }

  onClose(conn: Party.Connection) {
    this.table.disconnect(conn.id, Date.now());
    this.flush();
  }

  onError(conn: Party.Connection) {
    this.onClose(conn);
  }

  /** Used by the Next.js token route: resolve a reconnect secret to a seat. */
  async onRequest(req: Party.Request) {
    if (req.method !== "GET") return new Response("Method not allowed", { status: 405 });
    const secret = new URL(req.url).searchParams.get("secret");
    const id = this.table.playerIdFor(secret);
    const p = id ? this.table.state.players.find((q) => q.id === id) : null;
    if (!p) return Response.json({ error: "not seated" }, { status: 404 });
    return Response.json({ playerId: p.id, name: p.name });
  }

  private ensureTimer() {
    if (this.timer) return;
    this.timer = setInterval(() => {
      this.table.tick(Date.now());
      this.flush();
      if (this.table.connectionCount === 0 && this.table.state.phase === "lobby" && !this.table.dirty) {
        clearInterval(this.timer!);
        this.timer = null;
      }
    }, TICK_MS);
  }

  private flush(force = false) {
    const wasDirty = this.table.dirty;
    const out: Outbox = [];
    this.table.flush(Date.now(), out, force);
    this.send(out);
    if (wasDirty) {
      const snapshot = this.table.save();
      this.saving = this.saving.then(() => this.room.storage.put(STORAGE_KEY, snapshot)).catch(() => {});
    }
  }

  private send(out: Outbox) {
    for (const [cid, msg] of out) this.room.getConnection(cid)?.send(JSON.stringify(msg));
  }
}

TableServer satisfies Party.Worker;
