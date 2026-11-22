# Midnight Table

A browser Mafia party game played around a virtual table. Every player is a
bobblehead whose face is their live webcam. An automated narrator runs the game,
so nobody has to sit out as moderator. (The name lives in `lib/brand.ts`.)

- **Next.js (App Router) + TypeScript + Tailwind**: the UI, deployable to Vercel
- **PartyKit**: one room per table code, the single source of truth for game state
- **LiveKit Cloud**: video and audio. `/api/livekit-token` mints the tokens.
- **Framer Motion**: animation. **Vitest**: tests.

## Setup

```bash
npm install
cp .env.example .env.local   # then fill in the LiveKit values
```

| Variable | Where it's used |
| --- | --- |
| `LIVEKIT_URL` | Token route (server only), e.g. `wss://your-project.livekit.cloud` |
| `LIVEKIT_API_KEY` / `LIVEKIT_API_SECRET` | Token route (server only). Never exposed to the browser. |
| `NEXT_PUBLIC_PARTYKIT_HOST` | Browser + token route. `localhost:1999` in dev. |

Without LiveKit values the game still works: you see your own camera, and
everyone else appears with their initials.

## Run locally

Two terminals:

```bash
npm run dev:party   # PartyKit on :1999, with dev bots enabled
```

```bash
npm run dev         # Next.js on :3000
```

Open http://localhost:3000/play. You get a fresh 5-letter table code in the URL
(`/play#ABCDE`); share that link. To play alone, take a seat, press **🤖 Add bots
(dev only)**, then **Start game**.

## Test & build

```bash
npm run test        # engine + server tests
npm run build       # production build, type-checked
```

## Deploy

1. **PartyKit**: `npx partykit deploy`. Bots are off in production because
   `ALLOW_BOTS` is only passed by `npm run dev:party`.
2. **Vercel**: import the repo and set the env vars above, with
   `NEXT_PUBLIC_PARTYKIT_HOST=mafia-table.<your-user>.partykit.dev`.

## How it fits together

```
game/        pure, deterministic state machine (no network or UI)
  engine.ts    reduce(state, action) -> state. Time comes in on actions; randomness from a seeded RNG in state
  view.ts      viewFor(state, playerId): the ONLY data a client ever gets
  bots.ts      dev bot brains (server-side)
  narrator.ts  narrator lines, 3 variants per event
party/       PartyKit room: sockets -> actions, per-player filtered broadcasts, persistence
  table.ts     runtime-agnostic room logic (unit-tested)
  index.ts     PartyKit adapter
app/api/livekit-token   verifies the seat with PartyKit, then mints a LiveKit token
components/, hooks/     UI
```

**Hidden information.** Each socket receives `viewFor(state, itsPlayer)`, so other
players' roles, night picks and vote targets aren't in the message until they're
revealed. The acting player is always taken from the socket's secret, never from
the message body.

**Identity.** The browser keeps a random secret in `localStorage` (`mt:secret`).
The server maps it to a separate public player id, so refreshing gets your seat
and role back. The secret is never broadcast. The token route asks PartyKit who
owns the secret, so nobody can mint a LiveKit token for someone else's identity.

**Night and ghosts.** The sender's mic and camera tracks are stopped (not just
muted). As a second layer, every client also refuses to play anyone's audio at
night or a ghost's audio at any time.
