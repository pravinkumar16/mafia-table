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

## House rules

The host opens **House rules** in the lobby to choose how the game is played. Everyone at the
table can read the rules; only the host can change them, and only before the game starts. The
server validates every change, so a client can't turn on anything it shouldn't.

- **Deal**: Classic (Mafia, Doctor, Detective), Chaos or Paranoia, or your own mix.
- **Mafia**: Auto (2 for 7–8 players, 3 for 9–12, a quarter beyond) or 1–4. The Mafia must start outnumbered.
- **Discussion time**: 1:00 to 5:00. **Show a role when someone is out** can be switched off.
- The **Doctor and Detective are always in play.**

| Role | What it does |
| --- | --- |
| Godfather | Takes a Mafia seat. The Detective reads them as innocent. |
| Terrorist | Once a game, while the table is awake (morning, day, vote), goes out with a bang and takes one player along. |
| Judge | Once a game, overturns a vote. With a Judge in the game every verdict waits 12 s first, so the wait reveals nothing. |
| Lawyer | Once a game, shields one player: votes against them are void that day. Public. |
| Mayor | Vote counts double. Public from the start. |
| Heir | Inherits the first unused power to lose its owner: Doctor, Detective, Terrorist, Mayor, Judge or Lawyer. |
| Defector | Reads as innocent. If every Mafia member is gone, joins the Mafia and the game goes on. |
| Jester | Wins alone the moment the town votes them out. |
| Lovers | Two townspeople are secretly paired. If one dies, so does the other. |
| Night watch | Sleepers can keep watch and hear a clue at dawn (three names, one really was creeping around). The Mafia can tell how many are peeking. |
| Ghost haunts | Once a game, each ghost points the town at someone for the day, anonymously. |

If the chosen roles need more players than are seated, the lobby says so and **Start game** stays disabled.

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
