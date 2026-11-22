import { NextResponse, type NextRequest } from "next/server";
import { AccessToken } from "livekit-server-sdk";

export const dynamic = "force-dynamic";

const ROOM_RE = /^[A-Z]{5}$/;
const SECRET_RE = /^[A-Za-z0-9-]{16,64}$/;

function partyOrigin(host: string) {
  const local = /^(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?$/.test(host);
  return `${local ? "http" : "https"}://${host}`;
}

/**
 * Mints a LiveKit token for a seated player. The browser proves its seat with
 * its reconnect secret; we ask the PartyKit room who that is, so nobody can
 * mint a token for someone else's identity.
 */
export async function GET(req: NextRequest) {
  const url = process.env.LIVEKIT_URL;
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  if (!url || !apiKey || !apiSecret) {
    return NextResponse.json({ error: "LiveKit is not configured" }, { status: 503 });
  }

  const room = (req.nextUrl.searchParams.get("room") ?? "").toUpperCase();
  const secret = req.nextUrl.searchParams.get("secret") ?? "";
  if (!ROOM_RE.test(room) || !SECRET_RE.test(secret)) {
    return NextResponse.json({ error: "Bad request" }, { status: 400 });
  }

  const host = process.env.NEXT_PUBLIC_PARTYKIT_HOST || "localhost:1999";
  let seat: { playerId: string; name: string };
  try {
    const res = await fetch(`${partyOrigin(host)}/parties/main/${room}?secret=${encodeURIComponent(secret)}`, {
      cache: "no-store",
    });
    if (!res.ok) return NextResponse.json({ error: "Not seated at this table" }, { status: 403 });
    seat = await res.json();
  } catch {
    return NextResponse.json({ error: "Game server unreachable" }, { status: 502 });
  }

  const at = new AccessToken(apiKey, apiSecret, { identity: seat.playerId, name: seat.name, ttl: "4h" });
  at.addGrant({ room: `table-${room}`, roomJoin: true, canPublish: true, canSubscribe: true, canPublishData: false });
  return NextResponse.json(
    { token: await at.toJwt(), url },
    { headers: { "Cache-Control": "no-store" } },
  );
}
