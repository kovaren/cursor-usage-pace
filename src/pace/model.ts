import { UsageSummary } from "../api/usageClient";
import { computePace } from "./calculator";
import { PaceModel, PaceTrack, ShowMode } from "../ui/statusBar";

export interface BuildModelInput {
  summary: UsageSummary;
  fetchedAtMs: number;
  nowMs: number;
  show: ShowMode;
  staleAfterMs: number;
  /**
   * Force the model into the "cached" state regardless of cache age.
   * Used when we render from cache because the latest live fetch failed —
   * the cache itself may still be young, but the bar should signal that
   * the displayed numbers are not the result of the latest attempt.
   */
  forceStale?: boolean;
}

/**
 * Composes a `PaceModel` (UI-ready) from a parsed usage summary plus the
 * user's display preferences. The set of tracks shown is determined by
 * `show`; we preserve track order so the status bar text is stable.
 */
export function buildPaceModel(input: BuildModelInput): PaceModel {
  const cycle = input.summary.billingCycle;
  const tracks: PaceTrack[] = [];

  const auto: PaceTrack = {
    label: "Auto + Composer",
    shortLabel: "Auto",
    pace: computePace({
      actualPct: input.summary.plan.autoPercentUsed,
      cycle,
      nowMs: input.nowMs,
    }),
  };
  const api: PaceTrack = {
    label: "API",
    shortLabel: "API",
    pace: computePace({
      actualPct: input.summary.plan.apiPercentUsed,
      cycle,
      nowMs: input.nowMs,
    }),
  };
  const total: PaceTrack = {
    label: "Total",
    shortLabel: "Total",
    pace: computePace({
      actualPct: input.summary.plan.totalPercentUsed,
      cycle,
      nowMs: input.nowMs,
    }),
  };

  switch (input.show) {
    case "auto":
      tracks.push(auto);
      break;
    case "api":
      tracks.push(api);
      break;
    case "total":
      tracks.push(total);
      break;
    case "auto+api":
    default:
      tracks.push(auto, api);
      break;
  }

  const reference = tracks[0].pace.cycle;
  const isStale =
    input.forceStale === true ||
    input.nowMs - input.fetchedAtMs > input.staleAfterMs;

  return {
    tracks,
    cycleStartMs: cycle.startMs,
    cycleEndMs: cycle.endMs,
    daysRemaining: reference.daysRemaining,
    elapsedFraction: reference.elapsedFraction,
    fetchedAtMs: input.fetchedAtMs,
    isStale,
  };
}
