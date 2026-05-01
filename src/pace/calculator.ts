/**
 * Pure pace math. No I/O, no clocks beyond what's passed in — easy to test
 * for boundaries (cycle just started, cycle ended, leap-month, clock skew).
 */

export interface CycleWindow {
  startMs: number;
  endMs: number;
}

export interface PaceResult {
  actualPct: number;
  expectedPct: number;
  /** actual - expected, in percentage points. Positive = burning faster than pace. */
  deltaPp: number;
  /** Linear projection of the end-of-cycle percentage. */
  projectedEndPct: number;
  cycle: {
    elapsedMs: number;
    totalMs: number;
    elapsedFraction: number;
    daysRemaining: number;
  };
}

export interface ComputePaceInput {
  actualPct: number;
  cycle: CycleWindow;
  nowMs: number;
}

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function computePace(input: ComputePaceInput): PaceResult {
  const totalMs = Math.max(0, input.cycle.endMs - input.cycle.startMs);
  if (totalMs <= 0) {
    return {
      actualPct: clampPct(input.actualPct),
      expectedPct: 100,
      deltaPp: clampPct(input.actualPct) - 100,
      projectedEndPct: clampPct(input.actualPct),
      cycle: {
        elapsedMs: 0,
        totalMs: 0,
        elapsedFraction: 1,
        daysRemaining: 0,
      },
    };
  }

  const rawElapsed = input.nowMs - input.cycle.startMs;
  const elapsedMs = Math.max(0, Math.min(totalMs, rawElapsed));
  const elapsedFraction = elapsedMs / totalMs;
  const expectedPct = elapsedFraction * 100;
  const actualPct = clampPct(input.actualPct);
  const deltaPp = actualPct - expectedPct;
  const projectedEndPct = projectEnd(actualPct, elapsedFraction);
  const daysRemaining = Math.max(
    0,
    Math.ceil((input.cycle.endMs - input.nowMs) / MS_PER_DAY),
  );

  return {
    actualPct,
    expectedPct,
    deltaPp,
    projectedEndPct,
    cycle: {
      elapsedMs,
      totalMs,
      elapsedFraction,
      daysRemaining,
    },
  };
}

function clampPct(value: number): number {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  return value;
}

function projectEnd(actualPct: number, elapsedFraction: number): number {
  if (elapsedFraction <= 0) {
    return actualPct;
  }
  if (elapsedFraction >= 1) {
    return actualPct;
  }
  return actualPct / elapsedFraction;
}
