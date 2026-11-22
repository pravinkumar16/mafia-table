"use client";
import { useEffect, useRef, useState } from "react";
import {
  ConnectionState,
  LocalTrackPublication,
  Room,
  RoomEvent,
  Track,
  type RemoteParticipant,
  type RemoteTrack,
} from "livekit-client";

export type AVStatus = "off" | "connecting" | "connected" | "unavailable" | "error";

export interface LiveKitAV {
  status: AVStatus;
  /** participant identity (= public player id) -> track */
  remoteVideo: Record<string, MediaStreamTrack>;
  remoteAudio: Record<string, MediaStreamTrack>;
  /** identity -> audio level 0..1 (no re-render) */
  levelsRef: React.MutableRefObject<Record<string, number>>;
}

/**
 * Joins the table's LiveKit room once seated and publishes the given local
 * tracks. Passing null for a track unpublishes it.
 */
export function useLiveKit(
  code: string | null,
  secret: string | null,
  enabled: boolean,
  videoTrack: MediaStreamTrack | null,
  audioTrack: MediaStreamTrack | null,
): LiveKitAV {
  const [status, setStatus] = useState<AVStatus>("off");
  const [room, setRoom] = useState<Room | null>(null);
  const [remoteVideo, setRemoteVideo] = useState<Record<string, MediaStreamTrack>>({});
  const [remoteAudio, setRemoteAudio] = useState<Record<string, MediaStreamTrack>>({});
  const levelsRef = useRef<Record<string, number>>({});

  // Connect / disconnect
  useEffect(() => {
    if (!enabled || !code || !secret) {
      setStatus("off");
      return;
    }
    let cancelled = false;
    const r = new Room({ adaptiveStream: false, dynacast: true });

    const sync = () => {
      const v: Record<string, MediaStreamTrack> = {};
      const a: Record<string, MediaStreamTrack> = {};
      r.remoteParticipants.forEach((p: RemoteParticipant) => {
        p.trackPublications.forEach((pub) => {
          const t = pub.track as RemoteTrack | undefined;
          if (!t || !pub.isSubscribed || pub.isMuted) return;
          if (t.kind === Track.Kind.Video) v[p.identity] = t.mediaStreamTrack;
          if (t.kind === Track.Kind.Audio) a[p.identity] = t.mediaStreamTrack;
        });
      });
      setRemoteVideo(v);
      setRemoteAudio(a);
    };

    r.on(RoomEvent.TrackSubscribed, sync)
      .on(RoomEvent.TrackUnsubscribed, sync)
      .on(RoomEvent.TrackMuted, sync)
      .on(RoomEvent.TrackUnmuted, sync)
      .on(RoomEvent.ParticipantDisconnected, sync)
      .on(RoomEvent.ConnectionStateChanged, (s) => {
        if (s === ConnectionState.Connected) setStatus("connected");
        else if (s === ConnectionState.Reconnecting || s === ConnectionState.Connecting) setStatus("connecting");
      });

    const levelTimer = setInterval(() => {
      const levels: Record<string, number> = {};
      r.remoteParticipants.forEach((p) => (levels[p.identity] = p.audioLevel ?? 0));
      levelsRef.current = levels;
    }, 80);

    (async () => {
      setStatus("connecting");
      try {
        const res = await fetch(`/api/livekit-token?room=${encodeURIComponent(code)}&secret=${encodeURIComponent(secret)}`);
        if (res.status === 503) {
          if (!cancelled) setStatus("unavailable");
          return;
        }
        if (!res.ok) throw new Error(`token ${res.status}`);
        const { token, url } = (await res.json()) as { token: string; url: string };
        if (cancelled) return;
        await r.connect(url, token, { autoSubscribe: true });
        if (cancelled) return void r.disconnect();
        setRoom(r);
        setStatus("connected");
        sync();
      } catch (e) {
        console.warn("LiveKit connection failed", e);
        if (!cancelled) setStatus("error");
      }
    })();

    return () => {
      cancelled = true;
      clearInterval(levelTimer);
      r.removeAllListeners();
      r.disconnect();
      setRoom(null);
      setRemoteVideo({});
      setRemoteAudio({});
      levelsRef.current = {};
    };
  }, [enabled, code, secret]);

  // Publish the local tracks (re-publish when they change, unpublish on null).
  usePublish(room, videoTrack, Track.Source.Camera);
  usePublish(room, audioTrack, Track.Source.Microphone);

  return { status, remoteVideo, remoteAudio, levelsRef };
}

function usePublish(room: Room | null, track: MediaStreamTrack | null, source: Track.Source) {
  useEffect(() => {
    if (!room || !track) return;
    let pub: LocalTrackPublication | null = null;
    let cancelled = false;
    room.localParticipant
      .publishTrack(track, { source, simulcast: source === Track.Source.Camera })
      .then((p) => {
        if (cancelled) room.localParticipant.unpublishTrack(p.track!, false);
        else pub = p;
      })
      .catch((e) => console.warn("publish failed", e));
    return () => {
      cancelled = true;
      // Don't stop the underlying track here; useLocalMedia owns it.
      if (pub?.track) room.localParticipant.unpublishTrack(pub.track, false).catch(() => {});
    };
  }, [room, track, source]);
}
