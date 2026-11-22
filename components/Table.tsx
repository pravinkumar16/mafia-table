"use client";
import { useCallback, useEffect, useState } from "react";
import { motion } from "framer-motion";
import type { PlayerView, PublicPlayer } from "@/game";
import { ROLE_INFO } from "@/game/roles";
import Bobblehead from "./Bobblehead";

export interface SeatAV {
  video: (id: string) => MediaStreamTrack | null;
  level: (id: string) => number;
}

interface Props {
  view: PlayerView;
  meId: string;
  av: SeatAV;
  waves: Record<string, number>;
  /** ids that can be picked right now (night action or vote) */
  selectable: Set<string>;
  selectedId: string | null;
  onSelect: (id: string) => void;
  onWave: (id: string) => void;
  canWave: boolean;
  /** mafia only, at night: target id -> number of mafia picks */
  mafiaPicks: Record<string, number>;
  center: React.ReactNode;
}

export function useMediaQuery(query: string) {
  const [match, setMatch] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia(query);
    const on = () => setMatch(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, [query]);
  return match;
}

export const useIsNarrow = () => useMediaQuery("(max-width: 639px)");

const ROLE_CHIP: Record<string, string> = {
  mafia: "bg-blood/90 text-white",
  doctor: "bg-emerald-400/90 text-ink",
  detective: "bg-night/90 text-ink",
  villager: "bg-amber/90 text-ink",
  godfather: "bg-blood text-white",
  terrorist: "bg-orange-500/90 text-ink",
  judge: "bg-slate-300/90 text-ink",
  lawyer: "bg-sky-300/90 text-ink",
  heir: "bg-yellow-400/90 text-ink",
  defector: "bg-purple-400/90 text-ink",
  mayor: "bg-teal-300/90 text-ink",
  jester: "bg-pink-400/90 text-ink",
};

export default function Table(props: Props) {
  const narrow = useIsNarrow();
  const seats = [...props.view.players].sort((a, b) => a.seat - b.seat);
  const n = Math.max(seats.length, 1);

  if (narrow) {
    return (
      <div className="flex flex-col gap-3">
        <div className="felt rounded-[2rem] px-4 py-5">{props.center}</div>
        <div className="grid grid-cols-2 gap-3">
          {seats.map((p) => (
            <div key={p.id} className="flex justify-center rounded-2xl bg-white/[0.03] py-2">
              <Seat {...props} p={p} size={112} />
            </div>
          ))}
        </div>
      </div>
    );
  }

  // Circle: seats sit on a ring around the felt.
  const size = n <= 8 ? 128 : n <= 12 ? 112 : 96;
  const radius = 36; // % of the container
  return (
    <div className="relative mx-auto aspect-square w-full max-w-[min(100%,calc(100dvh-15rem))]">
      <div className="felt absolute inset-[21%] flex items-center justify-center rounded-full p-[6%] text-center">
        {props.center}
      </div>
      {seats.map((p, i) => {
        const angle = (i / n) * Math.PI * 2 - Math.PI / 2;
        return (
          <motion.div
            key={p.id}
            className="absolute"
            style={{
              left: `${50 + radius * Math.cos(angle)}%`,
              top: `${50 + radius * Math.sin(angle)}%`,
              translateX: "-50%",
              translateY: "-50%",
            }}
            initial={{ opacity: 0, scale: 0.6 }}
            animate={{ opacity: 1, scale: 1 }}
            transition={{ type: "spring", stiffness: 220, damping: 18 }}
          >
            <Seat {...props} p={p} size={size} />
          </motion.div>
        );
      })}
    </div>
  );
}

function Seat({
  p,
  view,
  meId,
  av,
  waves,
  selectable,
  selectedId,
  onSelect,
  onWave,
  canWave,
  mafiaPicks,
  size,
}: Props & { p: PublicPlayer; size: number }) {
  const night = view.phase === "night";
  const isMe = p.id === meId;
  const pickable = selectable.has(p.id);
  const selected = selectedId === p.id;
  const getLevel = useCallback(() => av.level(p.id), [av, p.id]);
  const ghost = view.phase !== "lobby" && !p.alive;
  const ring = selected ? "#f2b45a" : pickable ? "rgba(91,141,239,0.95)" : undefined;
  const tap = pickable ? () => onSelect(p.id) : canWave && !isMe && !ghost ? () => onWave(p.id) : undefined;
  const picks = mafiaPicks[p.id] ?? 0;

  return (
    <div className="flex flex-col items-center gap-1">
      <div className="relative">
        <Bobblehead
          name={p.name}
          bodyColor={p.bodyColor}
          skinColor={p.skinColor}
          video={ghost ? null : av.video(p.id)}
          mirror={isMe}
          getLevel={getLevel}
          waveCount={waves[p.id] ?? 0}
          ghost={ghost}
          asleep={night && p.alive}
          size={size}
          onTapHead={tap}
          headRing={ring}
        />
        {pickable && (
          <span className="pointer-events-none absolute -bottom-1 left-1/2 z-20 -translate-x-1/2 rounded-full bg-night px-2 py-0.5 font-display text-[11px] font-semibold text-ink shadow">
            {selected ? "Picked" : "Pick"}
          </span>
        )}
        {picks > 0 && (
          <span className="absolute -right-1 top-1 z-20 rounded-full bg-blood px-1.5 py-0.5 text-[11px] font-bold text-white shadow">
            🔪{picks > 1 ? `×${picks}` : ""}
          </span>
        )}
        {view.phase === "vote" && p.hasVoted && (
          <span className="absolute -left-1 top-1 z-20 rounded-full bg-amber px-1.5 py-0.5 text-[11px] font-bold text-ink shadow">✓</span>
        )}
      </div>
      <div className="flex max-w-[10rem] flex-col items-center leading-tight">
        <span className={`truncate text-center text-sm font-semibold ${ghost ? "text-muted line-through" : ""}`}>
          {p.isHost && <span title="Host">👑 </span>}
          {p.name}
          {isMe && <span className="text-muted"> (you)</span>}
        </span>
        <span className="flex items-center gap-1">
          {p.role && (
            <span className={`rounded-full px-2 py-px text-[10px] font-bold uppercase tracking-wide ${ROLE_CHIP[p.role]}`}>
              {ROLE_INFO[p.role].title}
            </span>
          )}
          {(!p.connected || p.left) && !p.isBot && (
            <span className="rounded-full bg-white/10 px-2 py-px text-[10px] text-muted">{p.left ? "left" : "away"}</span>
          )}
        </span>
      </div>
    </div>
  );
}
