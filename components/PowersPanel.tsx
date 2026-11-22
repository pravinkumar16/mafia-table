"use client";
import { useState } from "react";
import { motion } from "framer-motion";
import { isMafiaTeam, type PlayerView } from "@/game";
import type { ClientMessage } from "@/lib/protocol";

const nameOf = (v: PlayerView, id: string | null | undefined) => v.players.find((p) => p.id === id)?.name ?? "someone";

/**
 * Powers that are used in daylight, plus private notes. Everything here is shown
 * only to the player it belongs to: the server never sends anyone else's.
 */
export default function PowersPanel({ view, send }: { view: PlayerView; send: (m: ClientMessage) => void }) {
  const [picking, setPicking] = useState<"bomb" | "shield" | "haunt" | null>(null);
  const [target, setTarget] = useState<string | null>(null);

  const you = view.you;
  if (!you || view.phase === "lobby") return null;

  const phase = view.phase;
  const live = view.players.filter((p) => p.alive);
  const canBomb = you.role === "terrorist" && you.alive && !you.used && (phase === "morning" || phase === "day" || phase === "vote");
  const canShield = you.role === "lawyer" && you.alive && !you.used && (phase === "day" || phase === "vote");
  const canOverturn = you.role === "judge" && you.alive && !you.used && phase === "voteResult" && !!view.voteReport?.pending;
  const canWatch = phase === "night" && view.rules.nightWatch && you.alive && !isMafiaTeam(you.role);
  const canHaunt = !you.alive && view.rules.ghostHaunts && !you.hauntUsed && (phase === "day" || phase === "vote");
  const mafiaEyes = phase === "night" && isMafiaTeam(you.role) && you.watchers > 0;
  const loverName = you.loverId ? nameOf(view, you.loverId) : null;
  const loverAlive = you.loverId ? view.players.find((p) => p.id === you.loverId)?.alive : false;

  const choices = picking === "bomb" ? live.filter((p) => p.id !== you.id) : live;
  const close = () => {
    setPicking(null);
    setTarget(null);
  };
  const confirm = () => {
    if (!picking || !target) return;
    send({ t: picking, targetId: target });
    close();
  };

  const hasAnything = canWatch || canHaunt || mafiaEyes || canBomb || canShield || canOverturn || you.notes.length > 0 || (!!loverName && you.alive) || (you.alive && (you.role === "mayor" || you.role === "heir"));
  if (!hasAnything) return null;

  return (
    <motion.section initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="panel space-y-3 p-4">
      {you.alive && you.role === "mayor" && (
        <p className="text-sm">🎖️ You&apos;re the <b>Mayor</b>: your vote counts double, and everyone knows it.</p>
      )}
      {you.alive && you.role === "heir" && (
        <p className="text-sm">👑 You&apos;re the <b>Heir</b>. If a Doctor, Detective, Terrorist, Mayor, Judge or Lawyer dies with their power unused, it becomes yours.</p>
      )}
      {loverName && you.alive && (
        <p className="text-sm">
          💘 In love with <b>{loverName}</b>
          {loverAlive ? "." : " (gone)."}
        </p>
      )}

      {mafiaEyes && (
        <p className="text-sm">
          👀 <b>{you.watchers}</b> {you.watchers === 1 ? "sleeper is" : "sleepers are"} peeking through the dark tonight.
        </p>
      )}

      {canWatch && (
        <div>
          <p className="text-sm font-semibold">👀 Keep watch</p>
          {you.watching ? (
            <p className="mt-0.5 text-xs text-night">You&apos;re keeping watch. If you hear something, you&apos;ll know in the morning.</p>
          ) : (
            <>
              <p className="mt-0.5 text-xs text-muted">Peek through the dark for a noisy clue, heard at dawn. The Mafia will know someone is peeking.</p>
              <button className="btn-ghost mt-2 w-full" onClick={() => send({ t: "watch" })}>
                Keep watch
              </button>
            </>
          )}
        </div>
      )}

      {canHaunt && (
        <Power
          icon="👻"
          title="Haunt someone"
          blurb="Once a game: point the whole town at someone for today. Nobody learns which ghost did it."
          action="Pick someone"
          open={picking === "haunt"}
          onOpen={() => {
            setPicking("haunt");
            setTarget(null);
          }}
          onClose={close}
        >
          <Choices view={view} ids={choices.map((p) => p.id)} target={target} onPick={setTarget} />
          <button className="btn-amber mt-2 w-full" disabled={!target} onClick={confirm}>
            👻 Point{target ? ` at ${nameOf(view, target)}` : ""}
          </button>
        </Power>
      )}

      {canBomb && (
        <Power
          icon="💣"
          title="Go out with a bang"
          blurb="One shot. You and the player you pick both leave the table, right now. This can't be undone."
          action="Pick a target"
          open={picking === "bomb"}
          onOpen={() => {
            setPicking("bomb");
            setTarget(null);
          }}
          onClose={close}
        >
          <Choices view={view} ids={choices.map((p) => p.id)} target={target} onPick={setTarget} />
          <button className="btn mt-2 w-full bg-blood text-white" disabled={!target} onClick={confirm}>
            💥 Detonate{target ? ` with ${nameOf(view, target)}` : ""}
          </button>
        </Power>
      )}

      {canShield && (
        <Power
          icon="💼"
          title="Shield someone"
          blurb="Once a game. Votes against the player you pick won't count today, and everyone will know."
          action="Pick someone"
          open={picking === "shield"}
          onOpen={() => {
            setPicking("shield");
            setTarget(null);
          }}
          onClose={close}
        >
          <Choices view={view} ids={choices.map((p) => p.id)} target={target} onPick={setTarget} />
          <button className="btn-amber mt-2 w-full" disabled={!target} onClick={confirm}>
            🛡️ Shield{target ? ` ${nameOf(view, target)}` : ""}
          </button>
        </Power>
      )}

      {canOverturn && (
        <div>
          <p className="text-sm font-semibold">⚖️ The town chose {nameOf(view, view.voteReport?.eliminatedId)}.</p>
          <p className="mt-0.5 text-xs text-muted">Once a game, you can overturn the vote so nobody leaves today. Everyone will see it&apos;s you.</p>
          <button className="btn-amber mt-2 w-full" onClick={() => send({ t: "overturn" })}>
            Overturn the verdict
          </button>
        </div>
      )}

      {you.notes.length > 0 && (
        <div className="rounded-xl border border-white/10 bg-white/[0.04] p-2.5">
          <p className="mb-1 text-xs font-bold uppercase tracking-wide text-muted">📬 For your eyes only</p>
          <ul className="space-y-1 text-sm">
            {you.notes.map((n) => (
              <li key={n.id}>{n.text}</li>
            ))}
          </ul>
        </div>
      )}
    </motion.section>
  );
}

function Power({
  icon,
  title,
  blurb,
  action,
  open,
  onOpen,
  onClose,
  children,
}: {
  icon: string;
  title: string;
  blurb: string;
  action: string;
  open: boolean;
  onOpen: () => void;
  onClose: () => void;
  children: React.ReactNode;
}) {
  return (
    <div>
      <p className="text-sm font-semibold">
        {icon} {title}
      </p>
      <p className="mt-0.5 text-xs text-muted">{blurb}</p>
      {open ? (
        <div className="mt-2">
          {children}
          <button className="mt-1 w-full text-center text-xs text-muted underline" onClick={onClose}>
            Never mind
          </button>
        </div>
      ) : (
        <button className="btn-ghost mt-2 w-full" onClick={onOpen}>
          {action}
        </button>
      )}
    </div>
  );
}

function Choices({ view, ids, target, onPick }: { view: PlayerView; ids: string[]; target: string | null; onPick: (id: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {ids.map((id) => (
        <button
          key={id}
          onClick={() => onPick(id)}
          aria-pressed={target === id}
          className={`truncate rounded-xl border px-2 py-2 text-sm font-semibold transition ${
            target === id ? "border-amber bg-amber/20 text-amber" : "border-white/10 bg-white/5 hover:bg-white/10"
          }`}
        >
          {id === view.you?.id ? "Myself" : nameOf(view, id)}
        </button>
      ))}
    </div>
  );
}
