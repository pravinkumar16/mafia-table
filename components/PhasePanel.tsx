"use client";
import { useState } from "react";
import { motion } from "framer-motion";
import { SKIP, isMafiaTeam, type PlayerView } from "@/game";
import { MIN_PLAYERS, ROLE_INFO, validateRules } from "@/game/roles";
import type { ClientMessage } from "@/lib/protocol";
import { formatClock } from "@/hooks/useCountdown";
import RoleCard from "./RoleCard";

interface Props {
  view: PlayerView;
  secondsLeft: number | null;
  send: (m: ClientMessage) => void;
  showBots: boolean;
  inviteUrl: string;
}

const nameOf = (v: PlayerView, id: string | null | undefined) => v.players.find((p) => p.id === id)?.name ?? "someone";

export function phaseTitle(v: PlayerView): string {
  switch (v.phase) {
    case "lobby":
      return "Lobby";
    case "roleReveal":
      return "Your role";
    case "night":
      return `Night ${v.round}`;
    case "morning":
      return "Morning";
    case "day":
      return `Day ${v.round}`;
    case "vote":
      return "The vote";
    case "voteResult":
      return "The verdict";
    case "ended":
      return "Game over";
  }
}

/** The text on the felt in the middle of the table. */
export function TableCenter({ view, secondsLeft }: { view: PlayerView; secondsLeft: number | null }) {
  const count = view.players.length;
  return (
    <div className="flex flex-col items-center gap-1">
      <span className="font-display text-xs uppercase tracking-[0.3em] text-cream/60">{phaseTitle(view)}</span>
      {secondsLeft !== null ? (
        <motion.span
          key={view.phaseEndsAt}
          initial={{ scale: 0.8, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          className={`font-display text-4xl font-bold tabular-nums sm:text-5xl ${secondsLeft <= 10 ? "text-blood" : "text-cream"}`}
        >
          {formatClock(secondsLeft)}
        </motion.span>
      ) : (
        <span className="font-display text-3xl font-bold text-cream sm:text-4xl">
          {view.phase === "lobby" ? `${count} / ${MIN_PLAYERS}+` : view.winner === "village" ? "Village wins" : view.winner === "jester" ? "Jester wins" : "Mafia win"}
        </span>
      )}
      {view.phase === "lobby" && <span className="text-xs text-cream/60">{count} {count === 1 ? "person" : "people"} at the table</span>}
      {view.phase === "vote" && (
        <span className="text-xs text-cream/70">
          {view.votesCast} of {view.players.filter((p) => p.alive).length} voted
        </span>
      )}
    </div>
  );
}

export default function PhasePanel({ view, secondsLeft, send, showBots, inviteUrl }: Props) {
  const you = view.you!;
  const v = view;

  if (v.phase === "lobby") {
    const n = v.players.length;
    const rulesProblem = n >= MIN_PLAYERS ? validateRules(n, v.rules) : null;
    return (
      <Card title="Waiting for players">
        <p className="text-sm text-muted">
          {n < MIN_PLAYERS
            ? `${MIN_PLAYERS - n} more ${MIN_PLAYERS - n === 1 ? "player" : "players"} needed. Share the link!`
            : "Everyone's here. Ready when the host is."}
        </p>
        <InviteLink url={inviteUrl} />
        {you.isHost ? (
          <div className="mt-3 flex flex-col gap-2">
            <button className="btn-amber w-full py-3 text-lg" disabled={n < MIN_PLAYERS || !!rulesProblem} onClick={() => send({ t: "start" })}>
              Start game
            </button>
            {rulesProblem && (
              <p role="alert" className="rounded-xl bg-blood/10 px-3 py-2 text-xs text-blood">
                {rulesProblem} Open <b>House rules</b> to fix it.
              </p>
            )}
            {showBots && (
              <button
                className="btn-ghost w-full text-sm"
                disabled={n >= 16}
                onClick={() => send({ t: "addBots", count: Math.max(1, MIN_PLAYERS - n) })}
              >
                🤖 Add bots <span className="text-xs text-muted">(dev only)</span>
              </button>
            )}
          </div>
        ) : (
          <p className="mt-3 text-sm">
            Waiting for <b>{nameOf(v, v.hostId)}</b> (host) to start the game.
          </p>
        )}
      </Card>
    );
  }

  if (v.phase === "roleReveal") {
    const crew = you.mafiaTeam.filter((id) => id !== you.id).map((id) => nameOf(v, id));
    return (
      <Card title="Your secret role">
        <RoleCard role={you.role!} teammates={crew} />
        <button className="btn-amber mt-4 w-full" disabled={you.ready} onClick={() => send({ t: "ready" })}>
          {you.ready ? "Waiting for the others…" : "Got it, I'm ready"}
        </button>
      </Card>
    );
  }

  if (v.phase === "night") {
    if (!you.alive) return <GhostNote />;
    if (!you.myTurn) {
      return (
        <Card title="Shh…" night>
          <p className="text-sm text-[#cfe0ff]">Close your eyes. The city sleeps.</p>
          {isMafiaTeam(you.role) && v.nightStep !== "mafia" && <p className="mt-2 text-xs text-muted">Your crew has made its choice.</p>}
          <DetectiveNotes view={v} />
        </Card>
      );
    }
    const step = v.nightStep!;
    const heading = step === "mafia" ? "Choose your target" : step === "doctor" ? "Who will you protect?" : "Who will you investigate?";
    return (
      <Card title={heading} night>
        {step === "mafia" && (
          <p className="mb-2 text-xs text-muted">
            Your crew: {you.mafiaTeam.map((id) => nameOf(v, id)).join(", ")}. Most picks wins; a tie is settled by a coin toss.
          </p>
        )}
        {step === "doctor" && you.lastProtectedId && (
          <p className="mb-2 text-xs text-muted">You protected {nameOf(v, you.lastProtectedId)} last night, so not them again.</p>
        )}
        <p className="mb-2 text-xs text-muted">Tap a head on the table, or pick here:</p>
        <TargetList view={v} ids={you.targets} selected={you.myPick} onPick={(id) => send({ t: "night", targetId: id })} />
        {step === "mafia" && Object.keys(you.mafiaVotes).length > 0 && (
          <ul className="mt-3 space-y-0.5 text-xs text-muted">
            {Object.entries(you.mafiaVotes).map(([m, t]) => (
              <li key={m}>
                🔪 {nameOf(v, m)} → <b className="text-cream">{nameOf(v, t)}</b>
              </li>
            ))}
          </ul>
        )}
        {you.acted && step !== "mafia" && <p className="mt-2 text-sm text-night">Done. Close your eyes…</p>}
        <DetectiveNotes view={v} />
      </Card>
    );
  }

  if (v.phase === "morning") {
    const m = v.morning;
    const victim = v.players.find((p) => p.id === m?.killedId);
    return (
      <Card title="Morning report">
        {victim ? (
          <p>
            <b>{victim.name}</b> didn&apos;t survive the night.{" "}
            {victim.role ? (
              <>
                They were the <b>{ROLE_INFO[victim.role].title}</b>.
              </>
            ) : (
              "Their role stays a secret."
            )}
          </p>
        ) : m?.saved ? (
          <p>The Mafia struck, but the Doctor saved their target. 🩺</p>
        ) : (
          <p>Nobody died last night.</p>
        )}
        {!!m?.alsoDied.length && (
          <p className="mt-2 text-sm">
            💔 {m.alsoDied.map((id) => nameOf(v, id)).join(" and ")} died with them: secret Lovers.
          </p>
        )}
        {!you.alive && <GhostNote inline />}
        <DetectiveNotes view={v} />
      </Card>
    );
  }

  if (v.phase === "day") {
    return (
      <Card title="Discussion">
        <p className="text-sm text-muted">Talk it out. Who&apos;s been acting shifty? Voting starts when the timer runs out.</p>
        {v.immuneId && <p className="mt-2 text-sm">🛡️ <b>{nameOf(v, v.immuneId)}</b> is shielded from today&apos;s vote.</p>}
        {v.hauntedIds.length > 0 && (
          <p className="mt-2 text-sm">👻 A ghost pointed at <b>{v.hauntedIds.map((id) => nameOf(v, id)).join(" and ")}</b> today.</p>
        )}
        {you.isHost && (
          <button className="btn-ghost mt-3 w-full" onClick={() => send({ t: "skipDiscussion" })}>
            ⏭ Skip to the vote
          </button>
        )}
        {!you.alive && <GhostNote inline />}
        <DetectiveNotes view={v} />
      </Card>
    );
  }

  if (v.phase === "vote") {
    if (!you.alive) return <GhostNote />;
    const ids = v.players.filter((p) => p.alive && p.id !== you.id && p.id !== v.immuneId).map((p) => p.id);
    return (
      <Card title="Cast your vote">
        <p className="mb-2 text-xs text-muted">Votes stay secret until everyone has voted or time runs out. You can change yours until then.</p>
        {v.immuneId && <p className="mb-2 text-xs">🛡️ <b>{nameOf(v, v.immuneId)}</b> is shielded today, so they can&apos;t be voted for.</p>}
        {v.hauntedIds.length > 0 && (
          <p className="mb-2 text-xs">👻 A ghost pointed at <b>{v.hauntedIds.map((id) => nameOf(v, id)).join(" and ")}</b>.</p>
        )}
        <TargetList view={v} ids={ids} selected={you.myVote} onPick={(id) => send({ t: "vote", choice: id })} />
        <button
          className={`btn mt-2 w-full border ${you.myVote === SKIP ? "border-amber bg-amber/20" : "border-white/15 bg-white/5"}`}
          onClick={() => send({ t: "vote", choice: SKIP })}
        >
          🤷 Skip
        </button>
        <DetectiveNotes view={v} />
      </Card>
    );
  }

  if (v.phase === "voteResult" && v.voteReport) {
    const r = v.voteReport;
    const rows = Object.entries(r.tally).sort((a, b) => b[1] - a[1]);
    const max = Math.max(1, ...rows.map(([, c]) => c));
    const out = v.players.find((p) => p.id === r.eliminatedId);
    return (
      <Card title="The verdict">
        {r.pending ? (
          <p className="mb-3">
            <b>{nameOf(v, r.eliminatedId)}</b> has the most votes. The verdict is about to be read…
          </p>
        ) : r.overturned ? (
          <p className="mb-3">The Judge overturned the verdict. Nobody leaves today. ⚖️</p>
        ) : out ? (
          <p className="mb-3">
            <b>{out.name}</b> is out.{" "}
            {out.role ? (
              <>
                They were the <b>{ROLE_INFO[out.role].title}</b>.
              </>
            ) : (
              "Their role stays a secret."
            )}
          </p>
        ) : (
          <p className="mb-3">Nobody is eliminated today.</p>
        )}
        {r.immuneId && (
          <p className="mb-2 text-xs text-muted">🛡️ {nameOf(v, r.immuneId)} was shielded, so votes against them didn&apos;t count.</p>
        )}
        <ul className="space-y-1.5">
          {rows.map(([id, c]) => (
            <li key={id} className="text-sm">
              <div className="flex justify-between">
                <span>{id === SKIP ? "🤷 Skip" : nameOf(v, id)}</span>
                <span className="tabular-nums text-muted">{c}</span>
              </div>
              <motion.div
                className="mt-0.5 h-2 rounded-full bg-amber"
                initial={{ width: 0 }}
                animate={{ width: `${(c / max) * 100}%` }}
                transition={{ duration: 0.8, ease: "easeOut" }}
              />
            </li>
          ))}
          {rows.length === 0 && <li className="text-sm text-muted">No votes were cast.</li>}
        </ul>
        <details className="mt-3 text-xs text-muted">
          <summary className="cursor-pointer">Who voted for whom</summary>
          <ul className="mt-1 space-y-0.5">
            {Object.entries(r.ballots).map(([voter, choice]) => (
              <li key={voter}>
                {nameOf(v, voter)} → {choice === SKIP ? "skip" : nameOf(v, choice)}
              </li>
            ))}
          </ul>
        </details>
      </Card>
    );
  }

  return null;
}

function Card({ title, children, night }: { title: string; children: React.ReactNode; night?: boolean }) {
  return (
    <motion.section
      key={title}
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      className={`panel p-4 ${night ? "border-night/25 bg-night-deep/60" : ""}`}
    >
      <h2 className="mb-2 font-display text-xl font-semibold">{title}</h2>
      {children}
    </motion.section>
  );
}

function TargetList({ view, ids, selected, onPick }: { view: PlayerView; ids: string[]; selected: string | null; onPick: (id: string) => void }) {
  return (
    <div className="grid grid-cols-2 gap-1.5">
      {ids.map((id) => (
        <button
          key={id}
          onClick={() => onPick(id)}
          aria-pressed={selected === id}
          className={`truncate rounded-xl border px-2 py-2 text-sm font-semibold transition ${
            selected === id ? "border-amber bg-amber/20 text-amber" : "border-white/10 bg-white/5 hover:bg-white/10"
          }`}
        >
          {id === view.you?.id ? "Myself" : nameOf(view, id)}
        </button>
      ))}
    </div>
  );
}

function DetectiveNotes({ view }: { view: PlayerView }) {
  const results = view.you?.detectiveResults ?? [];
  if (view.you?.role !== "detective" || results.length === 0) return null;
  return (
    <div className="mt-3 rounded-xl border border-night/30 bg-night/10 p-2.5">
      <p className="mb-1 text-xs font-bold uppercase tracking-wide text-night">🔍 Your notebook (private)</p>
      <ul className="space-y-0.5 text-sm">
        {results.map((r) => (
          <li key={`${r.round}-${r.targetId}`}>
            Night {r.round}: <b>{nameOf(view, r.targetId)}</b> is{" "}
            {r.isMafia ? <b className="text-blood">Mafia</b> : <b className="text-emerald-400">Not Mafia</b>}
          </li>
        ))}
      </ul>
    </div>
  );
}

function GhostNote({ inline }: { inline?: boolean }) {
  const body = (
    <p className="text-sm text-muted">
      👻 You&apos;re a ghost. Watch quietly and chat with the other ghosts. No talking, voting or acting.
    </p>
  );
  return inline ? <div className="mt-3">{body}</div> : <Card title="You're a ghost">{body}</Card>;
}

function InviteLink({ url }: { url: string }) {
  return (
    <div className="mt-3">
      <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Invite friends to the table</p>
      <CopyButton text={url} />
    </div>
  );
}

export function CopyButton({ text, compact }: { text: string; compact?: boolean }) {
  const [copied, setCopied] = useState(false);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const el = document.createElement("textarea");
      el.value = text;
      document.body.appendChild(el);
      el.select();
      document.execCommand("copy");
      el.remove();
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };
  return (
    <button
      onClick={copy}
      className={`flex w-full items-center gap-2 rounded-xl border border-white/10 bg-black/30 text-left text-sm hover:border-amber/50 ${compact ? "px-2.5 py-1.5" : "px-3 py-2"}`}
    >
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-cream/80">{text}</span>
      <span className="shrink-0 font-display font-semibold text-amber">{copied ? "Copied!" : "Copy link"}</span>
    </button>
  );
}
