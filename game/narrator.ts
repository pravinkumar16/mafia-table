import type { NarrationEvent } from "./types";
import type { Rng } from "./rng";

// {name} = a player's name, {role} = a revealed role, {n} = a number.
export const SCRIPT: Record<NarrationEvent, string[]> = {
  lobby: [
    "Pull up a chair. The cards are shuffled and the night is young.",
    "Welcome to the table. Get comfortable — and keep an eye on your neighbours.",
    "The candles are lit, the felt is green, and somebody here is not who they seem.",
  ],
  roleReveal: [
    "Peek at your card. Keep your face still — the table is watching.",
    "Your fate is dealt. Look at your card, and tell no one.",
    "Cards on the table… face down. Take a look at yours, quietly.",
  ],
  nightFalls: [
    "Close your eyes. The city sleeps.",
    "Close your eyes. The city sleeps, and the streetlights flicker.",
    "Close your eyes. The city sleeps — well, most of it.",
  ],
  mafiaWake: [
    "Mafia, open your eyes. Choose who won't see the sunrise.",
    "Mafia, wake up. Nod to your crew and pick your mark.",
    "Mafia, the night is yours. Who's getting a visit?",
  ],
  doctorWake: [
    "Doctor, open your eyes. Who will you watch over tonight?",
    "Doctor, grab your bag. Someone may need you before dawn.",
    "Doctor, wake up. Choose one soul to keep safe.",
  ],
  detectiveWake: [
    "Detective, open your eyes. Whose secrets will you dig up?",
    "Detective, light your pipe. Pick someone to look into.",
    "Detective, wake up. Point at a suspect, and the night will whisper the truth.",
  ],
  morningDeath: [
    "The sun rises on bad news. {name} was found at dawn. They were the {role}.",
    "The rooster crows, but {name} doesn't. They were the {role}.",
    "Morning comes, and {name}'s chair is empty. They were the {role}.",
  ],
  morningSaved: [
    "Good morning! The Mafia struck in the night, but the Doctor got there first. Everyone wakes up.",
    "A close call! Someone was attacked last night, and the Doctor patched them up.",
    "The Mafia tried their luck, but a steady-handed Doctor saved the day. Nobody died.",
  ],
  morningQuiet: [
    "A strangely quiet night. Everyone wakes up… for now.",
    "Dawn breaks and every chair is filled. The Mafia must have overslept.",
    "Nobody died last night. Suspicious, isn't it?",
  ],
  dayStart: [
    "Open your eyes. Talk it out — who's been acting shifty?",
    "The town square is open. Accuse, defend, and bluff away.",
    "Daylight. Time to point fingers, politely.",
  ],
  voteStart: [
    "Time to vote. Pick who leaves the table — or skip if you're not sure.",
    "Ballots out. Who do you trust least?",
    "The town must decide. Cast your vote.",
  ],
  voteElimination: [
    "The town has spoken. {name} is out — they were the {role}.",
    "With {n} votes, {name} leaves the table. They were the {role}.",
    "{name} is escorted out of town. Their card reads: {role}.",
  ],
  voteNoElimination: [
    "No agreement. Everyone keeps their seat, for now.",
    "The town can't decide. Nobody is eliminated today.",
    "A hung jury. The Mafia breathe a little easier.",
  ],
  villageWins: [
    "The last of the Mafia is gone. The Village wins! Streetlights never looked so friendly.",
    "Justice! Every Mafia member is out. The Village wins.",
    "The city sleeps soundly at last. The Village wins!",
  ],
  mafiaWins: [
    "The Mafia now run this town. The Mafia win!",
    "The Village is outnumbered. The Mafia win — and they've taken the good chairs.",
    "Too late, the town realises who's in charge. The Mafia win!",
  ],
};

export function narrate(
  event: NarrationEvent,
  rng: Rng,
  vars: Record<string, string | number> = {},
): string {
  const line = rng.pick(SCRIPT[event]);
  return line.replace(/\{(\w+)\}/g, (_, key: string) => String(vars[key] ?? ""));
}
