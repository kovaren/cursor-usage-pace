import { describe, expect, it } from "vitest";
import { buildPaceModel } from "./model";
import type { UsageSummary } from "../api/usageClient";

const summary: UsageSummary = {
  billingCycle: {
    startMs: Date.parse("2026-04-04T00:00:00.000Z"),
    endMs: Date.parse("2026-05-04T00:00:00.000Z"),
  },
  plan: { autoPercentUsed: 12, apiPercentUsed: 38, totalPercentUsed: 17 },
  raw: undefined,
};

const nowMs = Date.parse("2026-04-19T12:00:00.000Z");
const STALE_AFTER_MS = 20 * 60 * 1000;

describe("buildPaceModel — isStale", () => {
  it("is false when the cache is younger than staleAfterMs", () => {
    const model = buildPaceModel({
      summary,
      fetchedAtMs: nowMs - 60 * 1000,
      nowMs,
      show: "auto+api",
      staleAfterMs: STALE_AFTER_MS,
    });
    expect(model.isStale).toBe(false);
  });

  it("is true when the cache is older than staleAfterMs", () => {
    const model = buildPaceModel({
      summary,
      fetchedAtMs: nowMs - 21 * 60 * 1000,
      nowMs,
      show: "auto+api",
      staleAfterMs: STALE_AFTER_MS,
    });
    expect(model.isStale).toBe(true);
  });

  it("is forced true via forceStale even when the cache is fresh", () => {
    const model = buildPaceModel({
      summary,
      fetchedAtMs: nowMs - 30 * 1000,
      nowMs,
      show: "auto+api",
      staleAfterMs: STALE_AFTER_MS,
      forceStale: true,
    });
    expect(model.isStale).toBe(true);
  });

  it("falls back to age-based check when forceStale is false", () => {
    const model = buildPaceModel({
      summary,
      fetchedAtMs: nowMs - 30 * 1000,
      nowMs,
      show: "auto+api",
      staleAfterMs: STALE_AFTER_MS,
      forceStale: false,
    });
    expect(model.isStale).toBe(false);
  });

  it("preserves the cache fetchedAtMs on the model", () => {
    const fetchedAtMs = nowMs - 5 * 60 * 1000;
    const model = buildPaceModel({
      summary,
      fetchedAtMs,
      nowMs,
      show: "auto+api",
      staleAfterMs: STALE_AFTER_MS,
      forceStale: true,
    });
    expect(model.fetchedAtMs).toBe(fetchedAtMs);
  });
});
