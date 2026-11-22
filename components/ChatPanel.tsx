"use client";
import { useEffect, useMemo, useRef, useState } from "react";
import type { Channel, PlayerView } from "@/game";

const LABEL: Record<Channel, string> = { public: "Table", mafia: "🔪 Mafia", ghost: "👻 Ghosts" };
const CLOSED_HINT: Record<Channel, string> = {
  public: "Public chat opens in the lobby and during the day.",
  mafia: "The Mafia can only whisper at night.",
  ghost: "Only ghosts can post here.",
};

export default function ChatPanel({
  view,
  meId,
  onSend,
  onSeen,
}: {
  view: PlayerView;
  meId: string;
  onSend: (channel: Channel, text: string) => void;
  onSeen?: () => void;
}) {
  const channels = (["public", "mafia", "ghost"] as Channel[]).filter((c) => view.chat[c]);
  const preferred: Channel = view.canWrite.mafia ? "mafia" : view.canWrite.ghost ? "ghost" : "public";
  const [tab, setTab] = useState<Channel>(preferred);
  const [text, setText] = useState("");
  const listRef = useRef<HTMLDivElement>(null);

  // Jump to the channel you can actually use when the phase changes.
  useEffect(() => setTab(preferred), [preferred]);
  const active = channels.includes(tab) ? tab : "public";
  const messages = useMemo(() => view.chat[active] ?? [], [view.chat, active]);

  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
    onSeen?.();
  }, [messages.length, onSeen]);

  const canWrite = view.canWrite[active];
  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    onSend(active, text);
    setText("");
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      {channels.length > 1 && (
        <div role="tablist" className="mb-2 flex gap-1">
          {channels.map((c) => (
            <button
              key={c}
              role="tab"
              aria-selected={active === c}
              onClick={() => setTab(c)}
              className={`rounded-full px-3 py-1 text-sm font-semibold ${active === c ? "bg-white/15" : "text-muted hover:bg-white/5"}`}
            >
              {LABEL[c]}
            </button>
          ))}
        </div>
      )}
      <div ref={listRef} className="scrollbar-thin min-h-0 flex-1 space-y-1.5 overflow-y-auto pr-1">
        {messages.length === 0 && <p className="py-6 text-center text-sm text-muted">No messages yet.</p>}
        {messages.map((m) =>
          m.fromId === "system" ? (
            <p key={m.id} className="py-0.5 text-center text-xs italic text-muted">
              {m.text}
            </p>
          ) : (
          <p key={m.id} className="text-sm leading-snug break-words">
            <b className={m.fromId === meId ? "text-amber" : active === "mafia" ? "text-blood" : "text-cream"}>{m.fromName}</b>{" "}
            <span className="text-cream/85">{m.text}</span>
          </p>
          ),
        )}
      </div>
      {canWrite ? (
        <form onSubmit={submit} className="mt-2 flex gap-2">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={300}
            placeholder={active === "mafia" ? "Whisper to your crew…" : active === "ghost" ? "Boo…" : "Say something…"}
            aria-label={`Message ${LABEL[active]}`}
            className="min-w-0 flex-1 rounded-xl border border-white/10 bg-black/30 px-3 py-2 text-sm outline-none focus:border-amber/60"
          />
          <button className="btn-amber px-3 py-2 text-sm" disabled={!text.trim()}>Send</button>
        </form>
      ) : (
        <p className="mt-2 rounded-xl bg-white/5 px-3 py-2 text-center text-xs text-muted">{CLOSED_HINT[active]}</p>
      )}
    </div>
  );
}
