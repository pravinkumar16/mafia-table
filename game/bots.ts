// Dev-only bot brains. Pure: given the full state and the time, returns the
// actions bots want to take now. Runs on the server only (it reads roles).

import { findPlayer, hasActedTonight, immuneToday, isMafiaTeam, living, nightStepOf, validNightTargets } from "./engine";
import { createRng, hashString, type Rng } from "./rng";
import { SKIP, type Action, type GameState, type Player } from "./types";

/** Each bot waits 1.5–5 s into a phase or night step before acting. */
export function botDelayMs(s: GameState, bot: Player): number {
  return 1500 + (hashString(`${bot.id}:${s.phase}:${s.round}:${s.night?.step ?? ""}`) % 3500);
}

const botRng = (s: GameState, bot: Player) =>
  createRng(hashString(`${s.rngSeed}:${bot.id}:${s.phase}:${s.round}:${s.night?.step ?? ""}`));

/** Daylight powers. Bots use them now and then, so games with those roles get exercised. */
function powerAction(s: GameState, bot: Player, rng: Rng, now: number): Action | null {
  if (!bot.alive || bot.used) return null;
  const others = living(s).filter((p) => p.id !== bot.id);
  if (bot.role === "terrorist" && (s.phase === "day" || s.phase === "vote") && others.length && rng.next() < 0.25) {
    return { type: "TERRORIST_BOMB", playerId: bot.id, targetId: rng.pick(others).id, now };
  }
  if (bot.role === "lawyer" && s.phase === "day" && rng.next() < 0.5) {
    return { type: "LAWYER_SHIELD", playerId: bot.id, targetId: rng.pick(living(s)).id, now };
  }
  if (bot.role === "judge" && s.phase === "voteResult" && s.voteReport?.pending && rng.next() < 0.5) {
    return { type: "JUDGE_OVERTURN", playerId: bot.id, now };
  }
  return null;
}

export function planBotActions(s: GameState, now: number): Action[] {
  const actions: Action[] = [];
  const bots = s.players.filter((p) => p.isBot);
  if (bots.length === 0) return actions;

  // A power can change who is alive, so when one fires it is the only action this tick.
  for (const bot of bots) {
    if (now - s.phaseStartedAt < botDelayMs(s, bot)) continue;
    const power = powerAction(s, bot, botRng(s, bot), now);
    if (power) return [power];
  }

  for (const bot of bots) {
    if (now - s.phaseStartedAt < botDelayMs(s, bot)) continue;
    const rng = botRng(s, bot);

    if (s.phase === "roleReveal" && !bot.ready) {
      actions.push({ type: "READY", playerId: bot.id, now });
    } else if (s.phase === "night" && s.night && bot.alive && nightStepOf(bot.role) === s.night.step) {
      if (hasActedTonight(s, bot.id)) continue;
      const targets = validNightTargets(s, bot.id);
      if (targets.length === 0) continue;
      let target: string;
      if (s.night.step === "mafia") {
        // Follow a teammate's pick (humans first) so the crew agrees.
        const picks = Object.entries(s.night.mafiaVotes).sort(
          ([a], [b]) => Number(findPlayer(s, a)?.isBot) - Number(findPlayer(s, b)?.isBot),
        );
        target = picks.length ? picks[0][1] : rng.pick(targets);
      } else if (s.night.step === "detective") {
        const checked = new Set(s.detectiveResults.map((r) => r.targetId));
        const fresh = targets.filter((t) => !checked.has(t));
        target = rng.pick(fresh.length ? fresh : targets);
      } else {
        target = rng.pick(targets);
      }
      actions.push({ type: "NIGHT_ACTION", playerId: bot.id, targetId: target, now });
    } else if (s.phase === "vote" && bot.alive && !(bot.id in s.votes)) {
      const immune = immuneToday(s);
      const others = living(s).filter((p) => p.id !== bot.id && p.id !== immune);
      let choice: string = SKIP;
      if (bot.role === "detective") {
        const known = s.detectiveResults.find((r) => r.isMafia && r.targetId !== immune && findPlayer(s, r.targetId)?.alive);
        if (known) choice = known.targetId;
      }
      if (choice === SKIP && rng.next() > 0.15) {
        const pool = isMafiaTeam(bot.role) ? others.filter((p) => !isMafiaTeam(p.role)) : others;
        if (pool.length) choice = rng.pick(pool).id;
      }
      actions.push({ type: "VOTE", playerId: bot.id, choice, now });
    }
  }
  return actions;
}
