import * as vscode from "vscode";
import { ShowMode } from "./ui/statusBar";

export const CONFIG_SECTION = "cursorUsagePace";

export interface ResolvedConfig {
  refreshIntervalMs: number;
  show: ShowMode;
  stateDbPath: string | undefined;
}

const DEFAULT_INTERVAL_MIN = 10;
const MIN_INTERVAL_MIN = 1;
const MAX_INTERVAL_MIN = 360;

export function readConfig(): ResolvedConfig {
  const cfg = vscode.workspace.getConfiguration(CONFIG_SECTION);
  const intervalMin = clamp(
    cfg.get<number>("refreshIntervalMinutes", DEFAULT_INTERVAL_MIN),
    MIN_INTERVAL_MIN,
    MAX_INTERVAL_MIN,
  );
  const show = normalizeShow(cfg.get<string>("show", "auto+api"));
  const stateDbPath = (cfg.get<string>("stateDbPath", "") ?? "").trim();
  return {
    refreshIntervalMs: intervalMin * 60 * 1000,
    show,
    stateDbPath: stateDbPath.length > 0 ? stateDbPath : undefined,
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(Math.max(value, min), max);
}

function normalizeShow(raw: string): ShowMode {
  switch (raw) {
    case "auto":
    case "api":
    case "total":
    case "auto+api":
      return raw;
    default:
      return "auto+api";
  }
}
