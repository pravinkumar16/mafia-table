"use client";
import { useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, useSpring } from "framer-motion";
import { initials } from "@/lib/identity";

export interface BobbleheadProps {
  name: string;
  bodyColor: string;
  skinColor: string;
  /** a live track to show as the face, or null for initials */
  video: MediaStreamTrack | null;
  mirror?: boolean;
  /** returns the current audio level 0..1 (polled, no re-render) */
  getLevel?: () => number;
  /** bump this number to trigger a wave wobble */
  waveCount?: number;
  ghost?: boolean;
  asleep?: boolean;
  size?: number;
  onTapHead?: () => void;
  headRing?: string;
}

function useVideo(track: MediaStreamTrack | null) {
  const ref = useRef<HTMLVideoElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.srcObject = track ? new MediaStream([track]) : null;
    if (track) el.play().catch(() => {});
  }, [track]);
  return ref;
}

export default function Bobblehead({
  name,
  bodyColor,
  skinColor,
  video,
  mirror,
  getLevel,
  waveCount = 0,
  ghost,
  asleep,
  size = 120,
  onTapHead,
  headRing,
}: BobbleheadProps) {
  const videoRef = useVideo(ghost || asleep ? null : video);
  // Low damping = a proper bobblehead wobble.
  const rotate = useSpring(0, { stiffness: 260, damping: 5, mass: 0.6 });
  const lift = useSpring(0, { stiffness: 300, damping: 9 });
  const [waving, setWaving] = useState(false);

  // Speaking: kick the head side to side in proportion to loudness.
  useEffect(() => {
    if (!getLevel || ghost || asleep) return;
    let dir = 1;
    const id = setInterval(() => {
      const lvl = getLevel();
      if (lvl > 0.06) {
        dir = -dir;
        rotate.set(dir * Math.min(14, 4 + lvl * 22));
        lift.set(-Math.min(6, lvl * 10));
      } else {
        rotate.set(0);
        lift.set(0);
      }
    }, 140);
    return () => clearInterval(id);
  }, [getLevel, ghost, asleep, rotate, lift]);

  // Waves: a big boing.
  const firstWave = useRef(waveCount);
  useEffect(() => {
    if (waveCount === firstWave.current) return;
    rotate.jump(22);
    rotate.set(0);
    lift.jump(-12);
    lift.set(0);
    setWaving(true);
    const t = setTimeout(() => setWaving(false), 900);
    return () => clearTimeout(t);
  }, [waveCount, rotate, lift]);

  const head = size * 0.62;
  const showVideo = !!video && !ghost && !asleep;

  return (
    <div
      className="relative flex flex-col items-center select-none"
      style={{ width: size, height: size * 1.12, filter: ghost ? "grayscale(1)" : undefined, opacity: ghost ? 0.45 : 1 }}
    >
      {/* Body (SVG) */}
      <svg
        viewBox="0 0 100 70"
        className="absolute bottom-0"
        style={{ width: size * 0.78, height: size * 0.55 }}
        aria-hidden
      >
        <rect x="42" y="0" width="16" height="14" rx="4" fill={skinColor} />
        <path d="M10 70 C10 30, 25 12, 50 12 C75 12, 90 30, 90 70 Z" fill={bodyColor} />
        <path d="M50 12 L42 26 L50 34 L58 26 Z" fill="rgba(255,255,255,0.18)" />
        <path d="M18 70 C18 45, 25 36, 30 34" stroke="rgba(0,0,0,0.18)" strokeWidth="3" fill="none" />
        <path d="M82 70 C82 45, 75 36, 70 34" stroke="rgba(0,0,0,0.18)" strokeWidth="3" fill="none" />
        <circle cx="50" cy="44" r="2.5" fill="rgba(0,0,0,0.25)" />
        <circle cx="50" cy="55" r="2.5" fill="rgba(0,0,0,0.25)" />
      </svg>

      {/* Head on a spring */}
      <motion.button
        type="button"
        onClick={onTapHead}
        disabled={!onTapHead}
        aria-label={onTapHead ? `${name}` : undefined}
        className="relative z-10 overflow-hidden rounded-full outline-none focus-visible:ring-4 focus-visible:ring-amber/70 enabled:cursor-pointer"
        style={{
          width: head,
          height: head,
          rotate,
          y: lift,
          originY: 1,
          background: skinColor,
          boxShadow: `0 6px 0 rgba(0,0,0,0.25), 0 0 0 3px ${headRing ?? "rgba(0,0,0,0.25)"}${headRing ? `, 0 0 18px ${headRing}` : ""}`,
        }}
        whileTap={onTapHead ? { scale: 0.94 } : undefined}
      >
        <video
          ref={videoRef}
          muted
          playsInline
          autoPlay
          className="absolute inset-0 h-full w-full object-cover"
          style={{ transform: mirror ? "scaleX(-1)" : undefined, opacity: showVideo ? 1 : 0 }}
        />
        {!showVideo && (
          <span
            className="absolute inset-0 flex items-center justify-center font-display font-bold text-ink/70"
            style={{ fontSize: head * 0.36 }}
          >
            {asleep ? "z" : initials(name)}
          </span>
        )}
      </motion.button>

      <AnimatePresence>
        {waving && (
          <motion.span
            initial={{ opacity: 0, y: 0, scale: 0.6 }}
            animate={{ opacity: 1, y: -18, scale: 1 }}
            exit={{ opacity: 0, y: -30 }}
            className="pointer-events-none absolute -top-2 right-0 z-20 text-2xl"
          >
            👋
          </motion.span>
        )}
      </AnimatePresence>
      {ghost && <span className="absolute -top-1 left-0 z-20 text-xl" aria-label="ghost">👻</span>}
    </div>
  );
}
