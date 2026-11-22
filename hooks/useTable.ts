"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import PartySocket from "partysocket";
import type { PlayerView } from "@/game";
import type { ClientMessage, ServerMessage } from "@/lib/protocol";

export type SocketStatus = "connecting" | "open" | "closed";

export interface TableConnection {
  view: PlayerView | null;
  playerId: string | null;
  botsAllowed: boolean;
  status: SocketStatus;
  error: string | null;
  clearError: () => void;
  /** server clock minus local clock, in ms */
  clockOffset: number;
  /** player id -> number of waves received (changes trigger a wobble) */
  waves: Record<string, number>;
  send: (msg: ClientMessage) => void;
}

export function useTable(code: string | null, secret: string | null): TableConnection {
  const [view, setView] = useState<PlayerView | null>(null);
  const [playerId, setPlayerId] = useState<string | null>(null);
  const [botsAllowed, setBotsAllowed] = useState(false);
  const [status, setStatus] = useState<SocketStatus>("connecting");
  const [error, setError] = useState<string | null>(null);
  const [clockOffset, setClockOffset] = useState(0);
  const [waves, setWaves] = useState<Record<string, number>>({});
  const socketRef = useRef<PartySocket | null>(null);

  useEffect(() => {
    if (!code || !secret) return;
    const host = process.env.NEXT_PUBLIC_PARTYKIT_HOST || "localhost:1999";
    const socket = new PartySocket({ host, room: code, query: { secret } });
    socketRef.current = socket;
    setStatus("connecting");

    const onMessage = (e: MessageEvent) => {
      let msg: ServerMessage;
      try {
        msg = JSON.parse(e.data);
      } catch {
        return;
      }
      switch (msg.t) {
        case "state":
          setView(msg.view);
          setClockOffset(msg.serverNow - Date.now());
          break;
        case "welcome":
          setPlayerId(msg.playerId);
          setBotsAllowed(msg.botsAllowed);
          break;
        case "error":
          setError(msg.message);
          break;
        case "wave":
          setWaves((w) => ({ ...w, [msg.targetId]: (w[msg.targetId] ?? 0) + 1 }));
          break;
      }
    };
    const onOpen = () => setStatus("open");
    const onClose = () => setStatus("closed");
    socket.addEventListener("message", onMessage);
    socket.addEventListener("open", onOpen);
    socket.addEventListener("close", onClose);
    return () => {
      socket.removeEventListener("message", onMessage);
      socket.removeEventListener("open", onOpen);
      socket.removeEventListener("close", onClose);
      socket.close();
      socketRef.current = null;
    };
  }, [code, secret]);

  const send = useCallback((msg: ClientMessage) => {
    socketRef.current?.send(JSON.stringify(msg));
  }, []);

  const clearError = useCallback(() => setError(null), []);

  // Seat the player only if the server says the seat is still theirs.
  const seatedId = playerId && view?.players.some((p) => p.id === playerId) ? playerId : null;

  return { view, playerId: seatedId, botsAllowed, status, error, clearError, clockOffset, waves, send };
}
