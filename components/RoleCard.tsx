"use client";
import { useState } from "react";
import { motion } from "framer-motion";
import type { Role } from "@/game";
import { ROLE_INFO } from "@/game/roles";

const ART: Record<Role, { emoji: string; bg: string }> = {
  mafia: { emoji: "🔪", bg: "linear-gradient(160deg,#5a1420,#d1495b)" },
  doctor: { emoji: "🩺", bg: "linear-gradient(160deg,#0f4a3a,#3fb58a)" },
  detective: { emoji: "🔍", bg: "linear-gradient(160deg,#1b2a4d,#5b8def)" },
  villager: { emoji: "🧑‍🌾", bg: "linear-gradient(160deg,#5a3a12,#f2b45a)" },
};

/** Face-down card that flips to show your role. */
export default function RoleCard({ role, teammates, onFlip }: { role: Role; teammates?: string[]; onFlip?: () => void }) {
  const [flipped, setFlipped] = useState(false);
  const info = ROLE_INFO[role];
  const flip = () => {
    if (!flipped) onFlip?.();
    setFlipped((f) => !f);
  };

  return (
    <button
      onClick={flip}
      className="group relative mx-auto block h-64 w-44 [perspective:900px]"
      aria-label={flipped ? `Your role: ${info.title}. Tap to hide.` : "Tap to reveal your role"}
    >
      <motion.div
        className="relative h-full w-full [transform-style:preserve-3d]"
        animate={{ rotateY: flipped ? 180 : 0 }}
        transition={{ type: "spring", stiffness: 140, damping: 16 }}
      >
        {/* back */}
        <div className="absolute inset-0 flex flex-col items-center justify-center rounded-2xl border-4 border-amber/70 bg-[repeating-linear-gradient(45deg,#1f4d36_0_10px,#143425_10px_20px)] shadow-2xl [backface-visibility:hidden]">
          <span className="font-display text-5xl">🂠</span>
          <span className="mt-3 font-display text-sm text-amber">Tap to peek</span>
        </div>
        {/* front */}
        <div
          className="absolute inset-0 flex flex-col items-center justify-center gap-2 rounded-2xl border-4 border-white/20 p-4 text-center shadow-2xl [backface-visibility:hidden] [transform:rotateY(180deg)]"
          style={{ background: ART[role].bg }}
        >
          <span className="text-5xl">{ART[role].emoji}</span>
          <span className="font-display text-2xl font-bold">{info.title}</span>
          <span className="text-xs uppercase tracking-widest opacity-80">Team {info.team}</span>
          <span className="text-xs leading-snug opacity-90">{info.blurb}</span>
          {teammates && teammates.length > 0 && (
            <span className="mt-1 rounded-lg bg-black/30 px-2 py-1 text-xs">Your crew: {teammates.join(", ")}</span>
          )}
        </div>
      </motion.div>
    </button>
  );
}
