import { describe, expect, it } from "vitest";
import * as vscode from "vscode";
import { buildPaceTooltip } from "./tooltip";
import type { PaceModel, PaceTrack } from "./statusBar";
import type { PaceResult } from "../pace/calculator";

const BAR_FILLED = "━";
const BAR_EMPTY = "┈";

function paceResult(overrides: Partial<PaceResult>): PaceResult {
  return {
    actualPct: 0,
    expectedPct: 50,
    deltaPp: 0,
    projectedEndPct: 0,
    status: "onPace",
    cycle: {
      elapsedMs: 1,
      totalMs: 2,
      elapsedFraction: 0.5,
      daysRemaining: 10,
    },
    ...overrides,
  };
}

function track(label: string, pace: PaceResult): PaceTrack {
  return { label, shortLabel: label.slice(0, 4), pace };
}

function minimalModel(tracks: PaceTrack[]): PaceModel {
  return {
    tracks,
    cycleStartMs: Date.parse("2026-04-01T00:00:00.000Z"),
    cycleEndMs: Date.parse("2026-05-01T00:00:00.000Z"),
    daysRemaining: 5,
    elapsedFraction: 0.5,
    fetchedAtMs: Date.parse("2026-04-15T12:00:00.000Z"),
    isStale: false,
  };
}

const commands = {
  refresh: "cursorUsagePace.refresh",
  openDashboard: "cursorUsagePace.openDashboard",
  showDiagnostics: "cursorUsagePace.showDiagnostics",
};

function firstBarSegment(md: vscode.MarkdownString): string {
  const m = md.value.match(/<tt>([^<]*)<\/tt>/);
  expect(m).toBeTruthy();
  return m![1];
}

describe("buildPaceTooltip — progress bars", () => {
  const nowMs = Date.parse("2026-04-15T14:00:00.000Z");

  it("sets supportHtml on the markdown string", () => {
    const md = buildPaceTooltip(
      minimalModel([track("Auto", paceResult({ actualPct: 10 }))]),
      commands,
      nowMs,
    );
    expect(md.supportHtml).toBe(true);
  });

  it("renders an empty bar at 0% and a full bar at 100%", () => {
    const empty = buildPaceTooltip(
      minimalModel([track("A", paceResult({ actualPct: 0 }))]),
      commands,
      nowMs,
    );
    expect(firstBarSegment(empty)).toBe(BAR_EMPTY.repeat(35));

    const full = buildPaceTooltip(
      minimalModel([track("B", paceResult({ actualPct: 100 }))]),
      commands,
      nowMs,
    );
    expect(firstBarSegment(full)).toBe(BAR_FILLED.repeat(35));
  });

  it("clamps usage below 0 and above 100 for the bar", () => {
    const low = buildPaceTooltip(
      minimalModel([track("Low", paceResult({ actualPct: -20 }))]),
      commands,
      nowMs,
    );
    expect(firstBarSegment(low)).toBe(BAR_EMPTY.repeat(35));

    const high = buildPaceTooltip(
      minimalModel([track("High", paceResult({ actualPct: 180 }))]),
      commands,
      nowMs,
    );
    expect(firstBarSegment(high)).toBe(BAR_FILLED.repeat(35));
  });

  it("rounds mid-range usage to the nearest segment (50% → 18 filled)", () => {
    const md = buildPaceTooltip(
      minimalModel([track("Mid", paceResult({ actualPct: 50 }))]),
      commands,
      nowMs,
    );
    const seg = firstBarSegment(md);
    const filled = [...seg].filter((ch) => ch === BAR_FILLED).length;
    const empty = [...seg].filter((ch) => ch === BAR_EMPTY).length;
    expect(filled).toBe(18);
    expect(empty).toBe(17);
    expect(seg.length).toBe(35);
  });

  it("escapes HTML in track labels for the dashboard tables", () => {
    const md = buildPaceTooltip(
      minimalModel([
        track(
          'Auto & API <em class="x">',
          paceResult({ actualPct: 1, deltaPp: 0 }),
        ),
      ]),
      commands,
      nowMs,
    );
    expect(md.value).toContain(
      "<strong>Auto &amp; API &lt;em class=&quot;x&quot;&gt;</strong>",
    );
    expect(md.value).not.toContain('<em class="x">');
  });
});
