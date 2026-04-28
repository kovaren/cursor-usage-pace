import * as vscode from "vscode";
import { PaceModel, PaceTrack } from "./statusBar";

export interface TooltipCommands {
  refresh: string;
  openDashboard: string;
  showDiagnostics: string;
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
  const elapsedPct = Math.round(model.elapsedFraction * 100);

  md.appendMarkdown(`**Cursor Usage Pace**\n\n`);
  md.appendMarkdown(
    `Cycle: **${cycleStart} → ${cycleEnd}** · ${elapsedPct}% elapsed · **${model.daysRemaining} day${
      model.daysRemaining === 1 ? "" : "s"
    } left**\n\n`,
  );

  md.appendMarkdown(`| Track | Used | Pace |\n`);
  md.appendMarkdown(`| --- | ---: | --- |\n`);
  for (const track of model.tracks) {
    const { used, pace } = formatRow(track);
    md.appendMarkdown(`| ${track.label} | ${used} | ${pace} |\n`);
  }
  md.appendMarkdown(`\n`);

  const freshness = model.isStale
    ? `_Offline — last refreshed ${formatRelative(nowMs - model.fetchedAtMs)}_`
    : `_Last refreshed ${formatRelative(nowMs - model.fetchedAtMs)}_`;

  const links = [
    `[Refresh](command:${commands.refresh})`,
    `[Dashboard](command:${commands.openDashboard})`,
    `[Diagnostics](command:${commands.showDiagnostics})`,
  ].join(" · ");

  md.appendMarkdown(`${freshness} · ${links}\n`);
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
    `[Refresh](command:${commands.refresh}) · [Diagnostics](command:${commands.showDiagnostics})\n`,
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
    `[Refresh](command:${commands.refresh}) · [Diagnostics](command:${commands.showDiagnostics})\n`,
  );
  return md;
}

function formatRow(track: PaceTrack): { used: string; pace: string } {
  return {
    used: `${track.pace.actualPct.toFixed(0)}%`,
    pace: formatPace(track.pace.deltaPp),
  };
}

const PACE_UNDER_COLOR = "#008000"; // green
const PACE_OVER_COLOR = "#FFA500"; // orange

function formatPace(deltaPp: number): string {
  const rounded = Math.round(deltaPp);
  if (rounded === 0) return "on pace";
  if (rounded < 0) {
    const text = `underused by ${Math.abs(rounded)}%`;
    return `<span style="color:${PACE_UNDER_COLOR};">${text}</span>`;
  }
  const text = `overused by ${rounded}%`;
  return `<span style="color:${PACE_OVER_COLOR};">${text}</span>`;
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
