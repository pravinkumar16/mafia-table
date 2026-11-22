"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AnimatePresence, motion } from "framer-motion";
import { getSecret, loadProfile, randomRoomCode, saveProfile, type Profile } from "@/lib/identity";
import { ROOM_CODE_RE } from "@/lib/protocol";
import { GAME_NAME } from "@/lib/brand";
import type { Channel } from "@/game";
import { useTable } from "@/hooks/useTable";
import { useLocalMedia } from "@/hooks/useLocalMedia";
import { useLiveKit } from "@/hooks/useLiveKit";
import { useCountdown } from "@/hooks/useCountdown";
import { useNarratorVoice } from "@/hooks/useNarratorVoice";
import JoinScreen from "./JoinScreen";
import Table, { useMediaQuery, type SeatAV } from "./Table";
import ControlBar from "./ControlBar";
import NarratorBanner from "./NarratorBanner";
import Lighting from "./Lighting";
import HouseRules from "./HouseRules";
import ChatPanel from "./ChatPanel";
import PhasePanel, { CopyButton, TableCenter } from "./PhasePanel";
import EndScreen from "./EndScreen";

const WAVE_PHASES = ["lobby", "morning", "day", "vote", "voteResult", "ended"];
const SHOW_DEV_BOTS = process.env.NODE_ENV !== "production";

function useRoomCode(): string | null {
  const [code, setCode] = useState<string | null>(null);
  useEffect(() => {
    const read = () => {
      const fromHash = window.location.hash.replace(/^#/, "").trim().toUpperCase();
      if (ROOM_CODE_RE.test(fromHash)) return setCode(fromHash);
      const fresh = randomRoomCode();
      history.replaceState(null, "", `/play#${fresh}`);
      setCode(fresh);
    };
    read();
    window.addEventListener("hashchange", read);
    return () => window.removeEventListener("hashchange", read);
  }, []);
  return code;
}

export default function PlayClient() {
  const code = useRoomCode();
  const [secret, setSecret] = useState<string | null>(null);
  const [profile, setProfileState] = useState<Profile | null>(null);
  const [narratorOn, setNarratorOn] = useState(true);
  const [chatOpen, setChatOpen] = useState(true);
  const [rulesOpen, setRulesOpen] = useState(false);
  const [leftLocally, setLeftLocally] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    setSecret(getSecret());
    setProfileState(loadProfile());
    setChatOpen(window.matchMedia("(min-width: 1024px)").matches);
  }, []);

  const setProfile = useCallback((p: Profile) => {
    setProfileState(p);
    saveProfile(p);
  }, []);

  const wide = useMediaQuery("(min-width: 1024px)");
  const table = useTable(code, secret);
  const view = table.view;
  const me = view?.you ?? null;
  const seated = !!table.playerId && !!me && !leftLocally;

  // Night and ghosts force mic + camera off at the source.
  const inGame = !!view && view.phase !== "lobby" && view.phase !== "ended";
  const night = view?.phase === "night";
  const ghost = seated && inGame && !me!.alive;
  const forcedOff = seated && night ? "Night: every mic and camera is off." : ghost ? "Ghosts can't speak. Use the ghost chat." : null;
  const camOn = !!profile?.cam && !forcedOff;
  const micOn = !!profile?.mic && !forcedOff && seated;
  const media = useLocalMedia(camOn, micOn);
  const lk = useLiveKit(code, secret, seated, media.videoTrack, media.audioTrack);

  const secondsLeft = useCountdown(view?.phaseEndsAt ?? null, table.clockOffset);
  useNarratorVoice(seated ? view?.narration : undefined, narratorOn && seated);

  // Errors from the server: toast while seated, inline on the join screen.
  useEffect(() => {
    if (!table.error || !seated) return;
    setToast(table.error);
    table.clearError();
  }, [table.error, seated, table]);
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3500);
    return () => clearTimeout(t);
  }, [toast]);

  // "You're the host now" when host passes to you.
  const prevHost = useRef<string | null>(null);
  useEffect(() => {
    if (!view || !me) return;
    if (prevHost.current && prevHost.current !== view.hostId && view.hostId === me.id) setToast("The host left. You're the host now 👑");
    prevHost.current = view.hostId;
  }, [view, me]);

  // Unread chat while the panel is closed.
  const totalMessages = view ? Object.values(view.chat).reduce((n, list) => n + (list?.length ?? 0), 0) : 0;
  const [seenMessages, setSeenMessages] = useState(0);
  const markSeen = useCallback(() => setSeenMessages(totalMessages), [totalMessages]);
  useEffect(() => {
    if (chatOpen) setSeenMessages(totalMessages);
  }, [chatOpen, totalMessages]);
  const unread = chatOpen ? 0 : Math.max(0, totalMessages - seenMessages);

  const meId = me?.id ?? "";
  const levelRef = media.levelRef;
  const lkLevels = lk.levelsRef;
  const av: SeatAV = useMemo(
    () => ({
      video: (id) => (id === meId ? media.videoTrack : (lk.remoteVideo[id] ?? null)),
      level: (id) => (id === meId ? levelRef.current : (lkLevels.current[id] ?? 0)),
    }),
    [meId, media.videoTrack, lk.remoteVideo, levelRef, lkLevels],
  );

  const join = () => {
    if (!profile) return;
    table.clearError();
    setLeftLocally(false);
    table.send({ t: "join", name: profile.name, bodyColor: profile.bodyColor, skinColor: profile.skinColor });
  };

  const leave = () => {
    table.send({ t: "leave" });
    setLeftLocally(true);
  };

  const inviteUrl = code && typeof window !== "undefined" ? `${window.location.origin}/play#${code}` : "";

  if (!code || !profile || !secret) {
    return <div className="flex min-h-dvh items-center justify-center font-display text-muted">Shuffling the deck…</div>;
  }

  if (!seated || !view || !me) {
    return (
      <>
        <Lighting night={false} />
        <JoinScreen
          code={code}
          profile={profile}
          setProfile={setProfile}
          videoTrack={media.videoTrack}
          getLevel={() => media.levelRef.current}
          camError={media.camError}
          micError={media.micError}
          seated={view?.players.length ?? 0}
          phase={view?.phase ?? null}
          status={table.status}
          error={table.error}
          onJoin={join}
        />
      </>
    );
  }

  const selectable = new Set<string>(
    night && me.myTurn
      ? me.targets
      : view.phase === "vote" && me.alive
        ? view.players.filter((p) => p.alive && p.id !== me.id).map((p) => p.id)
        : [],
  );
  const selectedId = night ? me.myPick : view.phase === "vote" ? me.myVote : null;
  const onSelect = (id: string) => table.send(night ? { t: "night", targetId: id } : { t: "vote", choice: id });
  const mafiaPicks: Record<string, number> = {};
  if (night) for (const t of Object.values(me.mafiaVotes)) mafiaPicks[t] = (mafiaPicks[t] ?? 0) + 1;
  const sleeping = night && !(me.alive && me.myTurn);

  // Receiver-side enforcement: never play audio at night or from ghosts.
  const audible = (id: string) => !night && !!view.players.find((p) => p.id === id && (p.alive || !inGame));

  const chat = <ChatPanel view={view} meId={me.id} onSend={(channel: Channel, text) => table.send({ t: "chat", channel, text })} onSeen={markSeen} />;

  return (
    <div className="min-h-dvh pb-28">
      <Lighting night={night} />

      {/* Remote audio */}
      {Object.entries(lk.remoteAudio).map(([id, track]) => (
        <RemoteAudio key={id} track={track} muted={!audible(id)} />
      ))}

      <header className="mx-auto flex max-w-7xl flex-wrap items-center gap-x-4 gap-y-2 px-4 pt-4">
        <h1 className="font-display text-2xl font-bold text-amber">{GAME_NAME}</h1>
        <span className="chip font-mono tracking-[0.2em] text-amber">{view.code}</span>
        <span className="chip">
          {view.players.length} {view.players.length === 1 ? "person" : "people"} at the table
        </span>
        <div className="ml-auto hidden w-72 sm:block">
          <CopyButton text={inviteUrl} compact />
        </div>
        {table.status !== "open" && (
          <span role="status" className="chip w-full border-amber/40 text-center text-amber sm:w-auto">
            Reconnecting to the table…
          </span>
        )}
        {lk.status === "error" && <span className="chip text-xs text-muted">Video unavailable right now</span>}
      </header>

      <div className="mx-auto mt-3 max-w-7xl px-4">
        <NarratorBanner narration={view.narration} night={night} />
      </div>

      <main className="mx-auto mt-4 grid max-w-7xl gap-4 px-4 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="relative">
          <Table
            view={view}
            meId={me.id}
            av={av}
            waves={table.waves}
            selectable={selectable}
            selectedId={selectedId}
            onSelect={onSelect}
            onWave={(id) => table.send({ t: "wave", targetId: id })}
            canWave={WAVE_PHASES.includes(view.phase) && (me.alive || !inGame)}
            mafiaPicks={mafiaPicks}
            center={sleeping ? null : <TableCenter view={view} secondsLeft={secondsLeft} />}
          />
          <AnimatePresence>
            {sleeping && (
              <motion.div
                className="pointer-events-none absolute inset-0 z-30 flex items-start justify-center rounded-[2rem] bg-[#050914]/85 backdrop-blur-[2px]"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.8 }}
              >
                <div className="sticky top-[30vh] mt-[20%] px-6 text-center sm:mt-[30%]">
                  <div className="text-5xl">🌙</div>
                  <p className="mt-3 font-display text-2xl font-semibold text-[#cfe0ff] sm:text-3xl">Close your eyes.</p>
                  <p className="font-display text-xl text-[#cfe0ff]/80 sm:text-2xl">The city sleeps.</p>
                  {secondsLeft !== null && <p className="mt-3 font-mono text-sm text-night">{secondsLeft}s</p>}
                </div>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        <aside className="flex min-w-0 flex-col gap-4">
          <PhasePanel view={view} secondsLeft={secondsLeft} send={table.send} showBots={SHOW_DEV_BOTS && table.botsAllowed} inviteUrl={inviteUrl} />
          {chatOpen && wide && <section className="panel h-[22rem] p-4">{chat}</section>}
        </aside>
      </main>

      {/* Mobile / tablet chat sheet */}
      <AnimatePresence>
        {chatOpen && !wide && (
          <motion.section
            className="panel fixed inset-x-2 bottom-[5.5rem] z-40 h-[55dvh] p-4 shadow-2xl"
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
          >
            <button onClick={() => setChatOpen(false)} className="absolute right-3 top-2 text-muted" aria-label="Close chat">
              ✕
            </button>
            {chat}
          </motion.section>
        )}
      </AnimatePresence>

      <ControlBar
        camOn={camOn}
        micOn={micOn}
        forcedOff={forcedOff}
        narratorOn={narratorOn}
        chatOpen={chatOpen}
        unread={unread}
        onCam={() => setProfile({ ...profile, cam: !profile.cam })}
        onMic={() => setProfile({ ...profile, mic: !profile.mic })}
        onNarrator={() => setNarratorOn((n) => !n)}
        onChat={() => setChatOpen((c) => !c)}
        onRules={() => setRulesOpen(true)}
        onLeave={leave}
      />

      <HouseRules
        open={rulesOpen}
        onClose={() => setRulesOpen(false)}
        rules={view.rules}
        playerCount={view.players.length}
        canEdit={me.isHost && view.phase === "lobby"}
        inLobby={view.phase === "lobby"}
        onChange={(patch) => table.send({ t: "setRules", rules: patch })}
      />
      {view.phase === "ended" && <EndScreen view={view} onPlayAgain={() => table.send({ t: "playAgain" })} />}

      <AnimatePresence>
        {toast && (
          <motion.div
            role="status"
            className="fixed left-1/2 top-4 z-[60] -translate-x-1/2 rounded-2xl border border-white/10 bg-ink-2 px-4 py-2.5 text-sm shadow-xl"
            initial={{ opacity: 0, y: -10 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -10 }}
          >
            {toast}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function RemoteAudio({ track, muted }: { track: MediaStreamTrack; muted: boolean }) {
  const ref = useRef<HTMLAudioElement>(null);
  useEffect(() => {
    if (!ref.current) return;
    ref.current.srcObject = new MediaStream([track]);
    ref.current.play().catch(() => {});
  }, [track]);
  useEffect(() => {
    if (ref.current) ref.current.muted = muted;
  }, [muted]);
  return <audio ref={ref} autoPlay playsInline />;
}
