"use client";
import { AnimatePresence, motion } from "framer-motion";
import { useEffect } from "react";

export default function HouseRules({ open, onClose }: { open: boolean; onClose: () => void }) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

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
            className="panel max-h-[88dvh] w-full max-w-lg overflow-y-auto p-6 scrollbar-thin sm:rounded-3xl"
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            onClick={(e) => e.stopPropagation()}
          >
            <h2 id="rules-title" className="mb-4 font-display text-2xl font-bold text-amber">House rules</h2>
            <div className="space-y-4 text-[15px] leading-relaxed">
              <p>
                A few of you are secretly <b>Mafia</b>. Everyone else is the <b>Village</b>. The narrator runs the
                game, so everybody gets to play.
              </p>
              <section>
                <h3 className="font-display text-lg">The roles</h3>
                <ul className="mt-1 space-y-1.5">
                  <li>🔪 <b>Mafia</b>: you know your crew. Each night you agree on someone to eliminate. By day, act innocent.</li>
                  <li>🩺 <b>Doctor</b>: each night, protect one player (yourself too). You can&apos;t pick the same person two nights in a row.</li>
                  <li>🔍 <b>Detective</b>: each night, check one player and privately learn whether they&apos;re Mafia.</li>
                  <li>🧑‍🌾 <b>Villager</b>: no powers, just your wits and your vote.</li>
                </ul>
                <p className="mt-2 text-sm text-muted">7–8 players: 2 Mafia. 9–12: 3 Mafia. 13+: about a quarter of the table.</p>
              </section>
              <section>
                <h3 className="font-display text-lg">A round</h3>
                <ol className="mt-1 list-decimal space-y-1.5 pl-5">
                  <li><b>Night.</b> Everyone&apos;s mic and video switch off. The Mafia pick a target, then the Doctor protects, then the Detective investigates. Each gets 30 seconds.</li>
                  <li><b>Morning.</b> The narrator reveals who died (and their role), or that the Doctor saved someone.</li>
                  <li><b>Day.</b> Mics back on. Talk it out for 3 minutes (the host can skip ahead).</li>
                  <li><b>Vote.</b> Vote for a player or skip. Most votes is out and their role is revealed. A tie, or skip winning, means nobody goes.</li>
                </ol>
              </section>
              <section>
                <h3 className="font-display text-lg">Ghosts</h3>
                <p>Dead players become ghosts. You can keep watching and chat with other ghosts, but you can&apos;t talk, vote or act.</p>
              </section>
              <section>
                <h3 className="font-display text-lg">Winning</h3>
                <p>The <b>Village</b> wins when every Mafia member is gone. The <b>Mafia</b> win when they equal or outnumber everyone else.</p>
              </section>
              <p className="text-sm text-muted">Tip: tap someone&apos;s head to wave at them.</p>
            </div>
            <button className="btn-amber mt-6 w-full" onClick={onClose} autoFocus>Done</button>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
