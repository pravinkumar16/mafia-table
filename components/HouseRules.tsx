"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useMemo } from "react";
import type { OptionalRole, Rules } from "@/game";
import { MAFIA_COUNT_OPTIONS, DISCUSSION_OPTIONS, DEALS, DEAL_ORDER, AVAILABLE_FEATURES, dealAvailable, dealOf, dealPatch, type Feature } from "@/game/rules";
import { MIN_PLAYERS, ROLE_INFO, mafiaCount, mafiaTotal, roleList, validateRules } from "@/game/roles";

interface Props {
  open: boolean;
  onClose: () => void;
  rules: Rules;
  playerCount: number;
  /** The host, in the lobby. Everyone else sees the rules read-only. */
  canEdit: boolean;
  inLobby: boolean;
  onChange: (patch: Partial<Rules>) => void;
}

const ROLE_ROWS: { key: OptionalRole; icon: string; blurb: string }[] = [
  { key: "godfather", icon: "🎩", blurb: "The Detective reads this Mafia member as innocent. Takes one of the Mafia seats." },
  { key: "terrorist", icon: "💣", blurb: "One shot: while the table is awake, go out with a bang and take someone with you." },
  { key: "judge", icon: "⚖️", blurb: "Once a game, overturns a vote: nobody leaves that day." },
  { key: "lawyer", icon: "💼", blurb: "Once a game, shields one player from the day's vote." },
  { key: "heir", icon: "👑", blurb: "Inherits the first unused power to lose its owner: Doctor, Detective, Terrorist, Mayor, Judge or Lawyer." },
  { key: "defector", icon: "🎭", blurb: "Looks like a plain townsperson. If every Mafia member is gone, switches sides." },
  { key: "mayor", icon: "🎖️", blurb: "Their vote counts double, and everyone can see who they are." },
  { key: "jester", icon: "🃏", blurb: "Wins alone the moment the town votes them out." },
];

const DEAL_ICONS: Record<string, string> = {
  godfather: "🎩",
  terrorist: "💣",
  defector: "🎭",
  jester: "🃏",
  lovers: "💘",
  nightWatch: "👀",
  ghostHaunts: "👻",
};

export default function HouseRules({ open, onClose, rules, playerCount, canEdit, inLobby, onChange }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const current = dealOf(rules);
  const problem = useMemo(() => validateRules(playerCount, rules), [playerCount, rules]);
  const summary = useMemo(() => {
    if (playerCount < MIN_PLAYERS || problem) return null;
    const counts = new Map<string, number>();
    for (const r of roleList(playerCount, rules)) counts.set(ROLE_INFO[r].title, (counts.get(ROLE_INFO[r].title) ?? 0) + 1);
    return [...counts.entries()].map(([t, n]) => (n > 1 ? `${n} ${t === "Mafia" ? "Mafia" : t + "s"}` : t)).join(", ");
  }, [playerCount, rules, problem]);

  const autoLabel = mafiaCount(Math.max(playerCount, MIN_PLAYERS));
  const locked = !canEdit;
  const set = (patch: Partial<Rules>) => canEdit && onChange(patch);

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 sm:items-center sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="rules-title"
            className="panel max-h-[92dvh] w-full max-w-xl overflow-y-auto p-5 scrollbar-thin sm:rounded-3xl sm:p-6"
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-start justify-between gap-3">
              <div>
                <h2 id="rules-title" className="font-display text-2xl font-bold text-amber">
                  House rules
                </h2>
                <p className="mt-0.5 text-sm text-muted">
                  {canEdit
                    ? "Pick a deal, tweak it, then start the game from the table."
                    : inLobby
                      ? "Set by the host. You can read them here."
                      : "Locked while the game is on."}
                </p>
              </div>
              <button className="btn-amber shrink-0 px-5 py-2" onClick={onClose} autoFocus>
                Done
              </button>
            </div>

            {/* Deal */}
            <Heading>Deal</Heading>
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
              {DEAL_ORDER.map((id) => {
                const ok = dealAvailable(id);
                const active = current === id;
                return (
                  <button
                    key={id}
                    disabled={locked || !ok}
                    aria-pressed={active}
                    onClick={() => set(dealPatch(id))}
                    className={`rounded-2xl border p-3 text-left transition disabled:cursor-not-allowed ${
                      active ? "border-amber bg-amber/10" : "border-white/10 bg-white/[0.03] enabled:hover:bg-white/[0.07]"
                    } ${!ok ? "opacity-50" : ""}`}
                  >
                    <span className={`font-display text-lg font-semibold ${active ? "text-amber" : ""}`}>{DEALS[id].title}</span>
                    <span className="mt-1 block text-xs leading-snug text-muted">{DEALS[id].blurb}</span>
                    <span className="mt-2 flex gap-1 text-sm" aria-hidden>
                      {DEALS[id].features.map((f) => (
                        <span key={f}>{DEAL_ICONS[f] ?? ""}</span>
                      ))}
                    </span>
                    {!ok && <span className="mt-1 block text-[10px] font-bold uppercase tracking-wide text-muted">Coming soon</span>}
                  </button>
                );
              })}
            </div>
            {current === "custom" && <p className="mt-2 text-xs text-muted">Custom: your own mix of roles.</p>}

            {/* Mafia count */}
            <Heading>Mafia</Heading>
            <div className="flex flex-wrap gap-2" role="group" aria-label="Number of Mafia">
              <Seg active={rules.mafiaCount === "auto"} disabled={locked} onClick={() => set({ mafiaCount: "auto" })}>
                Auto ({autoLabel})
              </Seg>
              {MAFIA_COUNT_OPTIONS.map((n) => (
                <Seg
                  key={n}
                  active={rules.mafiaCount === n}
                  disabled={locked || (playerCount >= MIN_PLAYERS && n * 2 >= playerCount)}
                  onClick={() => set({ mafiaCount: n })}
                >
                  {n}
                </Seg>
              ))}
            </div>

            {/* Roles */}
            <Heading>Roles</Heading>
            <ul className="divide-y divide-white/5">
              <Row icon="🩺" title="Doctor" blurb="Protects one player a night. Never the same player two nights running." locked="Always in play" />
              <Row icon="🔍" title="Detective" blurb="Checks one player a night: Mafia or not." locked="Always in play" />
              {ROLE_ROWS.map((r) => (
                <Row
                  key={r.key}
                  icon={r.icon}
                  title={ROLE_INFO[r.key].title}
                  blurb={r.blurb}
                  on={rules.roles[r.key]}
                  available={AVAILABLE_FEATURES.has(r.key)}
                  disabled={locked}
                  onToggle={(v) => set({ roles: { ...rules.roles, [r.key]: v } })}
                />
              ))}
              <Row
                icon="💘"
                title="Lovers"
                blurb="Two townspeople are secretly in love. If one dies, so does the other."
                on={rules.lovers}
                available={AVAILABLE_FEATURES.has("lovers" as Feature)}
                disabled={locked}
                onToggle={(v) => set({ lovers: v })}
              />
            </ul>

            {/* Between turns */}
            <Heading>Between turns</Heading>
            <ul className="divide-y divide-white/5">
              <Row
                title="Night watch"
                blurb="Sleepers can keep watch for a noisy clue."
                on={rules.nightWatch}
                available={AVAILABLE_FEATURES.has("nightWatch" as Feature)}
                disabled={locked}
                onToggle={(v) => set({ nightWatch: v })}
              />
              <Row
                title="Ghost haunts"
                blurb="Once a game, each ghost can point the town at someone."
                on={rules.ghostHaunts}
                available={AVAILABLE_FEATURES.has("ghostHaunts" as Feature)}
                disabled={locked}
                onToggle={(v) => set({ ghostHaunts: v })}
              />
            </ul>

            {/* Table */}
            <Heading>Table</Heading>
            <div className="flex flex-wrap items-center justify-between gap-2 py-1">
              <span className="text-sm font-semibold">Discussion time</span>
              <div className="flex gap-1.5" role="group" aria-label="Discussion time">
                {DISCUSSION_OPTIONS.map((s) => (
                  <Seg key={s} active={rules.discussionSeconds === s} disabled={locked} onClick={() => set({ discussionSeconds: s })}>
                    {Math.floor(s / 60)}:{String(s % 60).padStart(2, "0")}
                  </Seg>
                ))}
              </div>
            </div>
            <ul>
              <Row
                title="Show a role when someone is out"
                blurb="Off keeps every card hidden until the game ends."
                on={rules.revealRoles}
                available
                disabled={locked}
                onToggle={(v) => set({ revealRoles: v })}
              />
            </ul>

            {/* Check */}
            <div
              role="status"
              className={`mt-4 rounded-2xl border px-3 py-2.5 text-sm ${
                problem && playerCount >= MIN_PLAYERS ? "border-blood/40 bg-blood/10 text-blood" : "border-white/10 bg-white/[0.04] text-cream/90"
              }`}
            >
              {problem
                ? problem
                : summary
                  ? `With ${playerCount} players: ${summary}.`
                  : `Needs ${MIN_PLAYERS} or more players.`}
              {playerCount >= MIN_PLAYERS && !problem && rules.mafiaCount !== "auto" && (
                <span className="text-muted"> ({mafiaTotal(playerCount, rules)} Mafia chosen)</span>
              )}
            </div>

            <details className="mt-5 text-sm">
              <summary className="cursor-pointer font-display text-base font-semibold">How the game works</summary>
              <div className="mt-2 space-y-3 leading-relaxed">
                <p>
                  A few of you are secretly <b>Mafia</b>; everyone else is the <b>Village</b>. The narrator runs the game, so everybody gets to play.
                </p>
                <ol className="list-decimal space-y-1.5 pl-5">
                  <li><b>Night.</b> Every mic and camera switches off. The Mafia pick a target, then the Doctor protects, then the Detective investigates. 30 seconds each.</li>
                  <li><b>Morning.</b> The narrator says who died, or that the Doctor saved someone.</li>
                  <li><b>Day.</b> Mics back on. Talk it out; the host can skip ahead.</li>
                  <li><b>Vote.</b> Vote for a player or skip. Most votes is out. A tie, or skip winning, means nobody goes.</li>
                </ol>
                <p>
                  Dead players become <b>ghosts</b>: they watch and chat with other ghosts, but can&apos;t talk, vote or act. The Village wins when every
                  Mafia member is gone; the Mafia win when they equal or outnumber everyone else.
                </p>
                <p className="text-muted">Tip: tap someone&apos;s head to wave at them.</p>
              </div>
            </details>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

function Heading({ children }: { children: React.ReactNode }) {
  return <h3 className="mb-2 mt-5 text-[11px] font-bold uppercase tracking-[0.2em] text-muted">{children}</h3>;
}

function Seg({ active, disabled, onClick, children }: { active: boolean; disabled?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`rounded-lg border px-3 py-1.5 font-mono text-sm font-semibold transition disabled:cursor-not-allowed disabled:opacity-40 ${
        active ? "border-cream bg-cream text-ink" : "border-white/15 bg-black/30 enabled:hover:bg-white/10"
      }`}
    >
      {children}
    </button>
  );
}

function Row({
  icon,
  title,
  blurb,
  on,
  available = true,
  disabled,
  locked,
  onToggle,
}: {
  icon?: string;
  title: string;
  blurb: string;
  on?: boolean;
  available?: boolean;
  disabled?: boolean;
  /** Text shown instead of a switch for roles that can't be turned off. */
  locked?: string;
  onToggle?: (v: boolean) => void;
}) {
  const off = !locked && !on;
  return (
    <li className="flex items-center gap-3 py-2.5">
      {icon && (
        <span className="w-7 shrink-0 text-center text-xl" aria-hidden>
          {icon}
        </span>
      )}
      <div className={`min-w-0 flex-1 ${off ? "opacity-70" : ""}`}>
        <p className="text-sm font-semibold">{title}</p>
        <p className="text-xs leading-snug text-muted">{blurb}</p>
      </div>
      {locked ? (
        <span className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-muted">{locked}</span>
      ) : !available ? (
        <span className="shrink-0 rounded-full bg-white/10 px-2.5 py-1 text-[11px] font-semibold text-muted">Coming soon</span>
      ) : (
        <button
          role="switch"
          aria-checked={!!on}
          aria-label={title}
          disabled={disabled}
          onClick={() => onToggle?.(!on)}
          className={`relative h-6 w-11 shrink-0 rounded-full transition disabled:cursor-not-allowed disabled:opacity-50 ${on ? "bg-amber" : "bg-white/15"}`}
        >
          <span className={`absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all ${on ? "left-[1.375rem]" : "left-0.5"}`} />
        </button>
      )}
    </li>
  );
}
