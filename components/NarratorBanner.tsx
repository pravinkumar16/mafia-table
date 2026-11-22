"use client";
import { AnimatePresence, motion } from "framer-motion";
import type { Narration } from "@/game";

export default function NarratorBanner({ narration, night }: { narration: Narration; night: boolean }) {
  return (
    <div className="relative min-h-[3.5rem]" aria-live="polite">
      <AnimatePresence mode="wait">
        <motion.div
          key={narration.seq}
          initial={{ opacity: 0, y: -8, filter: "blur(4px)" }}
          animate={{ opacity: 1, y: 0, filter: "blur(0px)" }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.45 }}
          className={`flex items-start gap-3 rounded-2xl border px-4 py-3 ${
            night ? "border-night/30 bg-night-deep/60 text-[#cfe0ff]" : "border-amber/25 bg-amber/10 text-cream"
          }`}
        >
          <span aria-hidden className="text-2xl leading-none">🎩</span>
          <p className="font-display text-base leading-snug sm:text-lg">
            <span className="sr-only">Narrator: </span>
            {narration.text}
          </p>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}
