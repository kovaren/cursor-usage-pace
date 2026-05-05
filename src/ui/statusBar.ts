import * as vscode from "vscode";
import { PaceResult } from "../pace/calculator";
import { formatPercent } from "./tooltip";

export type ShowMode = "auto+api" | "auto" | "api" | "total";

export interface PaceTrack {
  label: string;
  shortLabel: string;
  pace: PaceResult;
}

export interface PaceModel {
  tracks: PaceTrack[];
  cycleStartMs: number;
  cycleEndMs: number;
  daysRemaining: number;
  elapsedFraction: number;
  fetchedAtMs: number;
  isStale: boolean;
}

export type StatusBarState =
  | { kind: "loading"; preserveLabel?: boolean }
  | { kind: "data"; model: PaceModel; tooltip: vscode.MarkdownString }
  | { kind: "signedOut"; tooltip: vscode.MarkdownString }
  | { kind: "error"; message: string; tooltip: vscode.MarkdownString };

const ALERT_PP = 10;

export class PaceStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;
  /** Last successful data model; used to keep label stable while refreshing. */
  private lastDataModel: PaceModel | undefined;

  constructor(commandId: string) {
    this.item = vscode.window.createStatusBarItem(
      vscode.StatusBarAlignment.Right,
      100,
    );
    this.item.command = commandId;
    this.item.name = "Cursor Usage Pace";
    this.item.show();
  }

  render(state: StatusBarState): void {
    switch (state.kind) {
      case "loading": {
        this.item.tooltip = "Fetching Cursor usage…";
        if (state.preserveLabel && this.lastDataModel) {
          this.item.text = renderBody(this.lastDataModel, {
            refreshing: true,
          });
          this.item.backgroundColor = pickBackground(this.lastDataModel);
        } else {
          this.item.text = "Cursor Usage Pace";
          this.item.backgroundColor = undefined;
        }
        break;
      }
      case "signedOut":
        this.lastDataModel = undefined;
        this.item.text = "$(warning) Cursor Usage Pace";
        this.item.tooltip = state.tooltip;
        this.item.backgroundColor = new vscode.ThemeColor(
          "statusBarItem.warningBackground",
        );
        break;
      case "error":
        this.lastDataModel = undefined;
        this.item.text = "$(warning) Cursor Usage Pace";
        this.item.tooltip = state.tooltip;
        this.item.backgroundColor = new vscode.ThemeColor(
          "statusBarItem.warningBackground",
        );
        break;
      case "data":
        this.lastDataModel = state.model;
        this.item.text = renderBody(state.model);
        this.item.tooltip = state.tooltip;
        this.item.backgroundColor = pickBackground(state.model);
        break;
    }
  }

  dispose(): void {
    this.item.dispose();
  }
}

function renderBody(
  model: PaceModel,
  opts: { refreshing?: boolean } = {},
): string {
  const segments = model.tracks.map((t) => {
    const sign = opts.refreshing
      ? "$(sync~spin)"
      : t.pace.deltaPp > 0
        ? "$(arrow-up)"
        : "$(arrow-down)";
    const pp = formatPercent(Math.abs(t.pace.deltaPp));
    return `${t.shortLabel}${sign}${pp}`;
  });
  const stale = model.isStale ? " $(history)" : "";
  return `${segments.join(" • ")}${stale}`;
}

function pickBackground(model: PaceModel): vscode.ThemeColor | undefined {
  const aheadOver = model.tracks.some((t) => t.pace.deltaPp > ALERT_PP);
  if (aheadOver) {
    return new vscode.ThemeColor("statusBarItem.warningBackground");
  }
  return undefined;
}
