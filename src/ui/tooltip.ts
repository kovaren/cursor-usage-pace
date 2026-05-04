import * as vscode from "vscode";
import { PaceModel, PaceTrack } from "./statusBar";

export interface TooltipCommands {
  refresh: string;
  openDashboard: string;
  showLogs: string;
}

const SHORT_DATE: Intl.DateTimeFormatOptions = {
  month: "short",
  day: "numeric",
};

export function buildPaceTooltip(
  model: PaceModel,
  commands: TooltipCommands,
  nowMs: number,
): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = true;
  md.supportThemeIcons = true;

  const cycleStart = formatDate(model.cycleStartMs);
  const cycleEnd = formatDate(model.cycleEndMs);
  const elapsedPct = formatPercent(model.elapsedFraction * 100);

  md.appendMarkdown(`**Cursor Usage Pace**\n\n`);
  md.appendMarkdown(
    `Cycle: **${cycleStart} → ${cycleEnd}** · ${elapsedPct} elapsed · **${model.daysRemaining} day${
      model.daysRemaining === 1 ? "" : "s"
    } left**\n\n`,
  );

  md.supportHtml = true;
  for (const track of model.tracks) {
    md.appendMarkdown(formatTrackDashboard(track));
  }
  md.appendMarkdown(`\n`);

  const freshnessText = model.isStale
    ? `Offline — last refreshed ${formatRelative(nowMs - model.fetchedAtMs)}`
    : `Last refreshed ${formatRelative(nowMs - model.fetchedAtMs)}`;

  const links = [
    htmlCommandLink("Refresh", commands.refresh),
    htmlCommandLink("Dashboard", commands.openDashboard),
    htmlCommandLink("Logs", commands.showLogs),
  ].join(" · ");

  md.appendMarkdown(
    `<table width="100%"><tr>` +
      `<td align="left"><em>${escapeHtml(freshnessText)}</em></td>` +
      `<td align="right">${links}</td>` +
      `</tr></table>\n`,
  );
  return md;
}

export function buildSignedOutTooltip(
  commands: TooltipCommands,
): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = true;
  md.appendMarkdown(`**Cursor Usage Pace**\n\n`);
  md.appendMarkdown(
    `Sign in to Cursor to see your usage pace.\n\n`,
  );
  md.appendMarkdown(
    `[Refresh](command:${commands.refresh}) · [Logs](command:${commands.showLogs})\n`,
  );
  return md;
}

export function buildErrorTooltip(
  message: string,
  commands: TooltipCommands,
): vscode.MarkdownString {
  const md = new vscode.MarkdownString(undefined, true);
  md.isTrusted = true;
  md.appendMarkdown(`**Cursor Usage Pace — couldn't refresh**\n\n`);
  md.appendCodeblock(message, "text");
  md.appendMarkdown(
    `\nThis usually means Cursor's usage endpoint is unreachable or has changed.\n\n`,
  );
  md.appendMarkdown(
    `[Refresh](command:${commands.refresh}) · [Logs](command:${commands.showLogs})\n`,
  );
  return md;
}

const USAGE_BAR_WIDTH = 35;
const BAR_FILLED = "━";
const BAR_EMPTY = "┈";

function formatTrackDashboard(track: PaceTrack): string {
  const bar = formatUsageBar(track.pace.actualPct, USAGE_BAR_WIDTH);
  const used = formatPercent(track.pace.actualPct);
  const pace = formatPace(track.pace.deltaPp);
  const label = escapeHtml(track.label);
  const barEscaped = escapeHtml(bar);
  const usedEscaped = escapeHtml(used);
  const tableLabelPace =
    `<table width="100%"><tr>` +
    `<td align="left"><strong>${label}</strong></td>` +
    `<td align="right">${pace}</td>` +
    `</tr></table>\n\n`;
  const tableBarUsed =
    `<table width="100%"><tr>` +
    `<td align="left"><tt>${barEscaped}</tt></td>` +
    `<td align="right">${usedEscaped} used</td>` +
    `</tr></table>\n\n`;
  return tableLabelPace + tableBarUsed;
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// Markdown-style `[label](command:foo)` links don't get parsed when they sit
// inside an inline HTML block (the `<table>` row), so anchors with explicit
// `command:` hrefs are used instead. Trusted MarkdownString permits these.
function htmlCommandLink(label: string, command: string): string {
  return `<a href="command:${encodeURI(command)}">${escapeHtml(label)}</a>`;
}

function formatUsageBar(actualPct: number, width: number): string {
  const filled = Math.round(
    (Math.min(100, Math.max(0, actualPct)) / 100) * width,
  );
  return BAR_FILLED.repeat(filled) + BAR_EMPTY.repeat(width - filled);
}

const PACE_UNDER_COLOR = "#008000"; // green
const PACE_OVER_COLOR = "#FFA500"; // orange

// Sub-1% values are common right after a billing cycle resets, and rounding
// them to whole percent makes the tooltip read "0%" while Cursor's own
// dashboard shows "1%". Show one decimal for small magnitudes so the user
// can see what's actually going on.
export function formatPercent(value: number): string {
  if (!Number.isFinite(value) || value === 0) return "0%";
  const abs = Math.abs(value);
  if (abs < 0.05) return value > 0 ? "<0.1%" : ">-0.1%";
  if (abs < 10) return `${value.toFixed(1)}%`;
  return `${value.toFixed(0)}%`;
}

function formatPace(deltaPp: number): string {
  if (Math.abs(deltaPp) < 0.05) return "on pace";
  if (deltaPp < 0) {
    const text = `underused by ${formatPercent(Math.abs(deltaPp))}`;
    return `<span style="color:${PACE_UNDER_COLOR};"><strong>${text}</strong></span>`;
  }
  const text = `overused by ${formatPercent(deltaPp)}`;
  return `<span style="color:${PACE_OVER_COLOR};"><strong>${text}</strong></span>`;
}

function formatDate(ms: number): string {
  return new Intl.DateTimeFormat(undefined, SHORT_DATE).format(new Date(ms));
}

function formatRelative(ageMs: number): string {
  if (ageMs < 0) return "just now";
  const sec = Math.floor(ageMs / 1000);
  if (sec < 60) return `${sec}s ago`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} min ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr}h ago`;
  const d = Math.floor(hr / 24);
  return `${d}d ago`;
}
