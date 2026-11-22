"use client";
import { motion } from "framer-motion";
import { isMafiaTeam, type PlayerView } from "@/game";
import { ROLE_INFO } from "@/game/roles";

export default function EndScreen({ view, onPlayAgain }: { view: PlayerView; onPlayAgain: () => void }) {
  const winner = view.winner;
  const players = [...view.players].sort((a, b) => Number(isMafiaTeam(b.role)) - Number(isMafiaTeam(a.role)) || a.seat - b.seat);
  const you = view.you;
  // The Mafia side includes a Defector who turned; the Jester wins alone.
  const youWon =
    !!you && (winner === "jester" ? you.role === "jester" : winner === "mafia" ? isMafiaTeam(you.role) : !isMafiaTeam(you.role) && you.role !== "jester");
  const headline = winner === "village" ? "The Village wins!" : winner === "mafia" ? "The Mafia win!" : "The Jester wins!";
  const tone = winner === "village" ? "text-amber" : winner === "mafia" ? "text-blood" : "text-pink-300";

  return (
    <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
      <motion.div
        role="dialog"
        aria-modal="true"
        aria-labelledby="end-title"
        className="panel max-h-[90dvh] w-full max-w-md overflow-y-auto p-6 text-center scrollbar-thin"
        initial={{ scale: 0.85, y: 30 }}
        animate={{ scale: 1, y: 0 }}
        transition={{ type: "spring", stiffness: 180, damping: 16 }}
      >
        <div className="text-5xl">{winner === "village" ? "🌅" : winner === "mafia" ? "🕴️" : "🃏"}</div>
        <h2 id="end-title" className={`mt-2 font-display text-3xl font-bold ${tone}`}>
          {headline}
        </h2>
        {you && <p className="mt-1 text-muted">{youWon ? (winner === "jester" ? "You fooled them all. 🎉" : "You're on the winning side. 🎉") : "Better luck next time."}</p>}
        <p className="mt-3 text-sm text-cream/80">{view.narration.text}</p>

        <ul className="mt-5 space-y-1.5 text-left">
          {players.map((p, i) => (
            <motion.li
              key={p.id}
              initial={{ opacity: 0, x: -10 }}
              animate={{ opacity: 1, x: 0 }}
              transition={{ delay: 0.15 + i * 0.05 }}
              className="flex items-center justify-between rounded-xl bg-white/5 px-3 py-2"
            >
              <span className={p.alive ? "" : "text-muted"}>
                {p.alive ? "" : "👻 "}
                {p.name}
              </span>
              <span className={`text-sm font-bold ${isMafiaTeam(p.role) ? "text-blood" : p.role === "jester" ? "text-pink-300" : "text-cream"}`}>
                {p.role ? ROLE_INFO[p.role].title : "?"}
                {p.defected && <span className="font-normal text-muted"> (Defector)</span>}
              </span>
            </motion.li>
          ))}
        </ul>

        {you?.isHost ? (
          <button className="btn-amber mt-6 w-full py-3 text-lg" onClick={onPlayAgain}>
            Play again
          </button>
        ) : (
          <p className="mt-6 text-sm text-muted">Waiting for the host to deal another game…</p>
        )}
      </motion.div>
    </motion.div>
  );
}
