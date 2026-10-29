/** Shared authoritative round timing: 10 stages per chapter, no phase-specific exceptions. */
import { PHASES, RULES } from './data';
export const chapterForRound = (round: number): number => Math.floor((round - 1) / PHASES.stagesPerChapter) + 1;
export function roundTimers(round: number): { preparationSeconds: number; combatSeconds: number; safetySeconds: number } {
  const timers = chapterForRound(round) === 1 ? RULES.chapterTimers.first : RULES.chapterTimers.later;
  // Preserve the existing grace period after acceleration starts.
  const safetySeconds = timers.combatSeconds + (RULES.combatSafetySeconds - RULES.combatSeconds);
  return { ...timers, safetySeconds };
}
