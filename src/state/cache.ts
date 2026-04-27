import * as vscode from "vscode";
import { UsageSummary } from "../api/usageClient";

const KEY = "cursorUsagePace.lastSummary.v1";
const SCHEMA_VERSION = 1;

interface CacheEnvelope {
  schema: number;
  fetchedAtMs: number;
  summary: SerializableSummary;
}

interface SerializableSummary {
  billingCycle: { startMs: number; endMs: number };
  plan: {
    autoPercentUsed: number;
    apiPercentUsed: number;
    totalPercentUsed: number;
  };
}

export interface CachedSummary {
  fetchedAtMs: number;
  summary: UsageSummary;
}

/**
 * Persists the last successful usage-summary response so the status bar can
 * still show a useful value if the next refresh fails (offline, transient
 * 5xx, token rotation). Stored in `globalState` so it follows the user
 * across workspaces but stays inside Cursor's own user-data directory.
 *
 * The raw API response is intentionally NOT cached — only the normalized
 * fields the UI needs.
 */
export class SummaryCache {
  constructor(private readonly memento: vscode.Memento) {}

  read(): CachedSummary | undefined {
    const envelope = this.memento.get<CacheEnvelope>(KEY);
    if (!envelope || envelope.schema !== SCHEMA_VERSION) {
      return undefined;
    }
    if (!isSerializableSummary(envelope.summary)) {
      return undefined;
    }
    return {
      fetchedAtMs: envelope.fetchedAtMs,
      summary: {
        billingCycle: envelope.summary.billingCycle,
        plan: envelope.summary.plan,
        raw: undefined,
      },
    };
  }

  async write(summary: UsageSummary, fetchedAtMs: number): Promise<void> {
    const envelope: CacheEnvelope = {
      schema: SCHEMA_VERSION,
      fetchedAtMs,
      summary: {
        billingCycle: summary.billingCycle,
        plan: summary.plan,
      },
    };
    await this.memento.update(KEY, envelope);
  }

  async clear(): Promise<void> {
    await this.memento.update(KEY, undefined);
  }
}

function isSerializableSummary(value: unknown): value is SerializableSummary {
  if (typeof value !== "object" || value === null) return false;
  const v = value as Record<string, unknown>;
  const cycle = v.billingCycle as Record<string, unknown> | undefined;
  const plan = v.plan as Record<string, unknown> | undefined;
  if (!cycle || !plan) return false;
  return (
    typeof cycle.startMs === "number" &&
    typeof cycle.endMs === "number" &&
    typeof plan.autoPercentUsed === "number" &&
    typeof plan.apiPercentUsed === "number" &&
    typeof plan.totalPercentUsed === "number"
  );
}
