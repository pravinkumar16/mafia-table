"use client";
import { useEffect, useState } from "react";

/** Seconds left until `endsAt` (server time), corrected by the clock offset. */
export function useCountdown(endsAt: number | null, clockOffset: number): number | null {
  const calc = () => (endsAt === null ? null : Math.max(0, Math.ceil((endsAt - (Date.now() + clockOffset)) / 1000)));
  const [left, setLeft] = useState<number | null>(calc);
  useEffect(() => {
    setLeft(calc());
    if (endsAt === null) return;
    const id = setInterval(() => setLeft(calc()), 250);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [endsAt, clockOffset]);
  return left;
}

export const formatClock = (s: number | null) =>
  s === null ? "" : `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
