"use client";
import { useEffect, useRef, useState } from "react";

export type MediaProblem = "denied" | "unavailable" | null;

export interface LocalMedia {
  videoTrack: MediaStreamTrack | null;
  audioTrack: MediaStreamTrack | null;
  camError: MediaProblem;
  micError: MediaProblem;
  /** live mic level 0..1, updated ~20x/s without re-rendering */
  levelRef: React.MutableRefObject<number>;
}

const problemOf = (e: unknown): MediaProblem =>
  e instanceof DOMException && (e.name === "NotAllowedError" || e.name === "SecurityError") ? "denied" : "unavailable";

/**
 * Owns the local camera and mic. Turning one off stops the hardware track,
 * so nothing can be sent while it's off (used for night and ghosts too).
 */
export function useLocalMedia(camOn: boolean, micOn: boolean): LocalMedia {
  const [videoTrack, setVideoTrack] = useState<MediaStreamTrack | null>(null);
  const [audioTrack, setAudioTrack] = useState<MediaStreamTrack | null>(null);
  const [camError, setCamError] = useState<MediaProblem>(null);
  const [micError, setMicError] = useState<MediaProblem>(null);
  const levelRef = useRef(0);

  useEffect(() => {
    if (!camOn) return;
    if (!navigator.mediaDevices?.getUserMedia) {
      setCamError("unavailable");
      return;
    }
    let cancelled = false;
    let track: MediaStreamTrack | null = null;
    navigator.mediaDevices
      .getUserMedia({ video: { width: { ideal: 320 }, height: { ideal: 320 }, facingMode: "user" } })
      .then((stream) => {
        track = stream.getVideoTracks()[0];
        if (cancelled) return track.stop();
        setCamError(null);
        setVideoTrack(track);
      })
      .catch((e) => !cancelled && setCamError(problemOf(e)));
    return () => {
      cancelled = true;
      track?.stop();
      setVideoTrack(null);
    };
  }, [camOn]);

  useEffect(() => {
    if (!micOn) {
      levelRef.current = 0;
      return;
    }
    if (!navigator.mediaDevices?.getUserMedia) {
      setMicError("unavailable");
      return;
    }
    let cancelled = false;
    let track: MediaStreamTrack | null = null;
    let ctx: AudioContext | null = null;
    let timer: ReturnType<typeof setInterval> | null = null;
    navigator.mediaDevices
      .getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
      .then((stream) => {
        track = stream.getAudioTracks()[0];
        if (cancelled) return track.stop();
        setMicError(null);
        setAudioTrack(track);
        // Analyse our own mic level for the head wobble.
        try {
          ctx = new AudioContext();
          const src = ctx.createMediaStreamSource(new MediaStream([track]));
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 512;
          src.connect(analyser);
          const buf = new Uint8Array(analyser.fftSize);
          timer = setInterval(() => {
            analyser.getByteTimeDomainData(buf);
            let sum = 0;
            for (const v of buf) sum += ((v - 128) / 128) ** 2;
            levelRef.current = Math.min(1, Math.sqrt(sum / buf.length) * 4);
          }, 50);
        } catch {}
      })
      .catch((e) => !cancelled && setMicError(problemOf(e)));
    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
      ctx?.close().catch(() => {});
      track?.stop();
      levelRef.current = 0;
      setAudioTrack(null);
    };
  }, [micOn]);

  return { videoTrack, audioTrack, camError, micError, levelRef };
}
