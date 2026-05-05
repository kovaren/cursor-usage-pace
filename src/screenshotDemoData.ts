import type { UsageSummary } from "./api/usageClient";

/**
 * Set to `false` after capturing README screenshots (before commit).
 */
export const SCREENSHOT_TOOLTIP_DEMO = true;

const CYCLE_START_MS = Date.UTC(2026, 3, 4);
const CYCLE_END_MS = Date.UTC(2026, 4, 4);

/**
 * README tooltip example: elapsed 53.2% ⇒ expected 53.2%; Auto 32.1% (−21.1pp);
 * API 69.3% (+16.1pp).
 */
export function screenshotDemoRenderInputs():
  | { summary: UsageSummary; fetchedAtMs: number; nowMs: number }
  | undefined {
  if (!SCREENSHOT_TOOLTIP_DEMO) return undefined;
  const elapsed = 0.532;
  const nowMs = CYCLE_START_MS + elapsed * (CYCLE_END_MS - CYCLE_START_MS);
  return {
    summary: {
      billingCycle: { startMs: CYCLE_START_MS, endMs: CYCLE_END_MS },
      plan: {
        autoPercentUsed: 32.1,
        apiPercentUsed: 69.3,
        totalPercentUsed: 50.7,
      },
      raw: { screenshotDemo: true },
    },
    fetchedAtMs: nowMs - 4 * 60 * 1000,
    nowMs,
  };
}
