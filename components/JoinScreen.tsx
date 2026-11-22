"use client";
import { motion } from "framer-motion";
import { BODY_COLORS, SKIN_COLORS, type Profile } from "@/lib/identity";
import { GAME_NAME, TAGLINE } from "@/lib/brand";
import type { MediaProblem } from "@/hooks/useLocalMedia";
import type { SocketStatus } from "@/hooks/useTable";
import { MIN_PLAYERS } from "@/game/roles";
import Bobblehead from "./Bobblehead";

interface Props {
  code: string;
  profile: Profile;
  setProfile: (p: Profile) => void;
  videoTrack: MediaStreamTrack | null;
  getLevel: () => number;
  camError: MediaProblem;
  micError: MediaProblem;
  seated: number;
  phase: string | null;
  status: SocketStatus;
  error: string | null;
  onJoin: () => void;
}

export default function JoinScreen(p: Props) {
  const { profile, setProfile } = p;
  const set = (patch: Partial<Profile>) => setProfile({ ...profile, ...patch });
  const inProgress = p.phase && p.phase !== "lobby";
  const canJoin = p.status === "open" && profile.name.trim().length > 0;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col items-center justify-center gap-8 px-4 py-10 md:flex-row md:gap-14">
      <section className="flex flex-col items-center gap-4">
        <motion.h1
          initial={{ opacity: 0, y: -10 }}
          animate={{ opacity: 1, y: 0 }}
          className="text-center font-display text-4xl font-bold tracking-tight text-amber md:text-5xl"
        >
          {GAME_NAME}
        </motion.h1>
        <p className="-mt-2 text-center text-muted">{TAGLINE}</p>
        <div className="felt flex h-72 w-72 items-center justify-center rounded-full">
          <Bobblehead
            name={profile.name || "You"}
            bodyColor={profile.bodyColor}
            skinColor={profile.skinColor}
            video={profile.cam ? p.videoTrack : null}
            mirror
            getLevel={p.getLevel}
            size={180}
          />
        </div>
        <div className="flex gap-2">
          <Toggle on={profile.cam} onClick={() => set({ cam: !profile.cam })} label="Camera" icon={profile.cam ? "📷" : "🚫"} />
          <Toggle on={profile.mic} onClick={() => set({ mic: !profile.mic })} label="Mic" icon={profile.mic ? "🎙️" : "🔇"} />
        </div>
        {(p.camError || p.micError) && (
          <p role="status" className="max-w-xs text-center text-sm text-amber">
            {p.camError === "denied" || p.micError === "denied"
              ? "Your browser blocked the camera or mic. You can still play: you'll show up with your initials. Allow access in the address bar to turn them on."
              : "No camera or mic found. You'll appear with your initials."}
          </p>
        )}
      </section>

      <section className="panel w-full max-w-sm p-6">
        <div className="mb-5 flex items-center justify-between">
          <span className="font-display text-lg">Table</span>
          <span className="chip font-mono tracking-[0.25em] text-amber">{p.code}</span>
        </div>

        <label className="mb-1 block text-sm font-semibold" htmlFor="name">
          Your name at the table
        </label>
        <input
          id="name"
          autoFocus
          maxLength={20}
          value={profile.name}
          onChange={(e) => set({ name: e.target.value })}
          onKeyDown={(e) => e.key === "Enter" && canJoin && p.onJoin()}
          placeholder="e.g. Lucky Lou"
          className="mb-5 w-full rounded-2xl border border-white/10 bg-black/30 px-4 py-3 text-lg outline-none placeholder:text-white/25 focus:border-amber/70"
        />

        <p className="mb-2 text-sm font-semibold">Wardrobe</p>
        <Swatches label="Body" colors={BODY_COLORS} value={profile.bodyColor} onPick={(c) => set({ bodyColor: c })} />
        <Swatches label="Skin" colors={SKIN_COLORS} value={profile.skinColor} onPick={(c) => set({ skinColor: c })} />

        <button className="btn-amber mt-5 w-full py-3.5 text-lg" disabled={!canJoin} onClick={p.onJoin}>
          Take a Seat
        </button>
        <p className="mt-3 text-center text-sm text-muted">
          Table needs {MIN_PLAYERS} or more players.
          {p.seated > 0 && (
            <>
              {" "}
              <span className="text-cream">
                {p.seated} {p.seated === 1 ? "person is" : "people are"} already here.
              </span>
            </>
          )}
        </p>
        {inProgress && !p.error && (
          <p className="mt-3 rounded-xl bg-night/15 p-3 text-center text-sm text-night">
            A game is in progress at this table. If you were playing, you&apos;ll get your seat back.
          </p>
        )}
        {p.error && (
          <p role="alert" className="mt-3 rounded-xl bg-blood/15 p-3 text-center text-sm text-blood">
            {p.error}
          </p>
        )}
        {p.status !== "open" && (
          <p className="mt-3 text-center text-sm text-muted">
            {p.status === "connecting" ? "Connecting to the table…" : "Can't reach the game server. Retrying…"}
          </p>
        )}
      </section>
    </main>
  );
}

function Toggle({ on, onClick, label, icon }: { on: boolean; onClick: () => void; label: string; icon: string }) {
  return (
    <button
      onClick={onClick}
      aria-pressed={on}
      className={`btn ${on ? "bg-white/10 text-cream" : "bg-blood/20 text-blood"} border border-white/10`}
    >
      <span aria-hidden>{icon}</span> {label} {on ? "on" : "off"}
    </button>
  );
}

function Swatches({ label, colors, value, onPick }: { label: string; colors: string[]; value: string; onPick: (c: string) => void }) {
  return (
    <div className="mb-3 flex items-center gap-3">
      <span className="w-10 text-xs uppercase tracking-wide text-muted">{label}</span>
      <div className="flex flex-wrap gap-1.5">
        {colors.map((c) => (
          <button
            key={c}
            aria-label={`${label} colour ${c}`}
            aria-pressed={value === c}
            onClick={() => onPick(c)}
            className={`h-7 w-7 rounded-full border-2 transition ${value === c ? "scale-110 border-amber" : "border-white/10 hover:scale-105"}`}
            style={{ background: c }}
          />
        ))}
      </div>
    </div>
  );
}
