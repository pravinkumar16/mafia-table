"use client";
import { useEffect, useRef } from "react";
import type { Narration } from "@/game";

/** Reads each new narration line aloud with the Web Speech API. */
export function useNarratorVoice(narration: Narration | undefined, enabled: boolean) {
  const lastSeq = useRef<number | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
    if (!enabled) {
      window.speechSynthesis.cancel();
      return;
    }
    if (!narration || narration.seq === lastSeq.current) return;
    const first = lastSeq.current === null;
    lastSeq.current = narration.seq;
    // Don't read a stale line out loud when you first sit down mid-phase.
    if (first && narration.event === "lobby") return;

    const synth = window.speechSynthesis;
    synth.cancel();
    const u = new SpeechSynthesisUtterance(narration.text.replace(/🤖/g, ""));
    const voices = synth.getVoices();
    const voice =
      voices.find((v) => /en-GB/i.test(v.lang) && /male|daniel|arthur|george/i.test(v.name)) ??
      voices.find((v) => /^en/i.test(v.lang));
    if (voice) u.voice = voice;
    u.rate = 0.95;
    u.pitch = 0.85;
    synth.speak(u);
  }, [narration, enabled]);

  useEffect(() => () => {
    if (typeof window !== "undefined" && "speechSynthesis" in window) window.speechSynthesis.cancel();
  }, []);
}
