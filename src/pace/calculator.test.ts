import { describe, expect, it } from "vitest";
import { computePace } from "./calculator";

const startMs = Date.parse("2026-04-04T00:00:00.000Z");
const endMs = Date.parse("2026-05-04T00:00:00.000Z");
const cycle = { startMs, endMs };

describe("computePace", () => {
  it("matches the screenshot scenario (Apr 27, API 38%)", () => {
    const now = Date.parse("2026-04-27T00:00:00.000Z");
    const result = computePace({ actualPct: 38, cycle, nowMs: now });
    expect(result.expectedPct).toBeCloseTo(76.667, 2);
    expect(result.deltaPp).toBeCloseTo(-38.667, 2);
    expect(result.projectedEndPct).toBeCloseTo(49.565, 2);
    expect(result.status).toBe("behind");
    expect(result.cycle.daysRemaining).toBe(7);
  });

  it("classifies onPace within +/- threshold", () => {
    const now = Date.parse("2026-04-19T00:00:00.000Z");
    const result = computePace({
      actualPct: 50,
      cycle,
      nowMs: now,
      onPaceThresholdPp: 3,
    });
    expect(result.expectedPct).toBeCloseTo(50, 2);
    expect(result.status).toBe("onPace");
  });

  it("classifies ahead when burning faster than pace", () => {
    const now = Date.parse("2026-04-09T00:00:00.000Z");
    const result = computePace({ actualPct: 60, cycle, nowMs: now });
    expect(result.status).toBe("ahead");
    expect(result.deltaPp).toBeGreaterThan(0);
  });

  it("treats now == start as elapsedFraction 0 and projects to current value", () => {
    const result = computePace({ actualPct: 0, cycle, nowMs: startMs });
    expect(result.cycle.elapsedFraction).toBe(0);
    expect(result.expectedPct).toBe(0);
    expect(result.projectedEndPct).toBe(0);
    expect(result.status).toBe("onPace");
  });

  it("clamps when now is before the cycle starts (clock skew)", () => {
    const earlier = startMs - 24 * 60 * 60 * 1000;
    const result = computePace({ actualPct: 5, cycle, nowMs: earlier });
    expect(result.cycle.elapsedFraction).toBe(0);
    expect(result.expectedPct).toBe(0);
    expect(result.deltaPp).toBe(5);
  });

  it("clamps when now is after the cycle ends", () => {
    const later = endMs + 24 * 60 * 60 * 1000;
    const result = computePace({ actualPct: 80, cycle, nowMs: later });
    expect(result.cycle.elapsedFraction).toBe(1);
    expect(result.expectedPct).toBe(100);
    expect(result.cycle.daysRemaining).toBe(0);
    expect(result.projectedEndPct).toBe(80);
  });

  it("handles a zero-length cycle without dividing by zero", () => {
    const result = computePace({
      actualPct: 25,
      cycle: { startMs, endMs: startMs },
      nowMs: startMs,
    });
    expect(result.cycle.totalMs).toBe(0);
    expect(result.cycle.elapsedFraction).toBe(1);
    expect(Number.isFinite(result.projectedEndPct)).toBe(true);
  });

  it("handles a leap-day cycle (Feb 1 -> Mar 1, 2028)", () => {
    const leapStart = Date.parse("2028-02-01T00:00:00.000Z");
    const leapEnd = Date.parse("2028-03-01T00:00:00.000Z");
    const halfway = Date.parse("2028-02-15T12:00:00.000Z");
    const result = computePace({
      actualPct: 50,
      cycle: { startMs: leapStart, endMs: leapEnd },
      nowMs: halfway,
    });
    expect(result.cycle.totalMs).toBe(29 * 24 * 60 * 60 * 1000);
    expect(result.expectedPct).toBeCloseTo(50, 1);
    expect(result.status).toBe("onPace");
  });

  it("clamps a negative actualPct to 0", () => {
    const result = computePace({ actualPct: -10, cycle, nowMs: startMs });
    expect(result.actualPct).toBe(0);
  });

  it("respects a custom onPaceThresholdPp", () => {
    const now = Date.parse("2026-04-19T00:00:00.000Z");
    const result = computePace({
      actualPct: 55,
      cycle,
      nowMs: now,
      onPaceThresholdPp: 10,
    });
    expect(result.status).toBe("onPace");
  });
});
