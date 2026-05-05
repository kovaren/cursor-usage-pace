/**
 * Client for `https://cursor.com/api/usage-summary` — the same endpoint
 * Cursor's own dashboard hits to render the Auto+Composer / API progress
 * bars and the "Resets on …" plan card.
 *
 * This endpoint is undocumented and may change. We deliberately keep the
 * parser permissive (multiple field names, percentage normalization) and
 * surface the raw response on success so the extension's logs view
 * can show the user exactly what came back.
 */

const DEFAULT_BASE_URL = "https://cursor.com";
const ENDPOINT_PATH = "/api/usage-summary";
const DEFAULT_TIMEOUT_MS = 10_000;

export interface UsageSummary {
  billingCycle: {
    startMs: number;
    endMs: number;
  };
  plan: {
    autoPercentUsed: number;
    apiPercentUsed: number;
    totalPercentUsed: number;
  };
  raw: unknown;
}

export type UsageFetchResult =
  | { ok: true; summary: UsageSummary }
  | { ok: false; reason: UsageFetchErrorReason; status?: number; message: string };

export type UsageFetchErrorReason =
  | "unauthorized"
  | "network"
  | "timeout"
  | "parse"
  | "http";

export interface FetchUsageOptions {
  cookieValue: string;
  userAgent: string;
  timeoutMs?: number;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export async function fetchUsageSummary(
  opts: FetchUsageOptions,
): Promise<UsageFetchResult> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const baseUrl = opts.baseUrl ?? DEFAULT_BASE_URL;
  const url = `${baseUrl}${ENDPOINT_PATH}`;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  let response: Response;
  try {
    response = await fetchImpl(url, {
      method: "GET",
      headers: {
        Accept: "application/json",
        "User-Agent": opts.userAgent,
        Cookie: `WorkosCursorSessionToken=${opts.cookieValue}`,
      },
      signal: controller.signal,
    });
  } catch (err) {
    clearTimeout(timeout);
    const e = err as Error & { name?: string };
    if (e?.name === "AbortError") {
      return {
        ok: false,
        reason: "timeout",
        message: `Timed out after ${timeoutMs}ms`,
      };
    }
    return {
      ok: false,
      reason: "network",
      message: e?.message ?? String(err),
    };
  }
  clearTimeout(timeout);

  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      reason: "unauthorized",
      status: response.status,
      message: "Cursor rejected the session token. Try signing back in.",
    };
  }

  if (!response.ok) {
    return {
      ok: false,
      reason: "http",
      status: response.status,
      message: `${response.status} ${response.statusText}`,
    };
  }

  let body: unknown;
  try {
    body = await response.json();
  } catch (err) {
    return {
      ok: false,
      reason: "parse",
      message: `Response was not valid JSON: ${(err as Error).message}`,
    };
  }

  try {
    const summary = parseUsageSummary(body);
    return { ok: true, summary };
  } catch (err) {
    return {
      ok: false,
      reason: "parse",
      message: (err as Error).message,
    };
  }
}

export function parseUsageSummary(raw: unknown): UsageSummary {
  if (typeof raw !== "object" || raw === null) {
    throw new Error("Usage summary response was not an object");
  }
  const root = raw as Record<string, unknown>;

  const startMs = parseDate(
    pickFirst(root, ["billingCycleStart", "currentPeriodStart", "startOfMonth"]),
  );
  const endMs = parseDate(
    pickFirst(root, ["billingCycleEnd", "currentPeriodEnd", "endOfMonth"]),
  );
  if (startMs === null || endMs === null) {
    throw new Error("Usage summary response is missing billing cycle dates");
  }
  if (endMs <= startMs) {
    throw new Error("Usage summary returned a non-positive billing cycle");
  }

  const planSource = findPlanLikeContainer(root);
  // Only field names with explicit "Percent" semantics are accepted. Earlier
  // versions also fell back to `autoUsage`/`apiUsage`, but those names are
  // ambiguous: in some responses they appear to carry a raw count (e.g.
  // number of Auto messages used) rather than a 0..100 percentage, which
  // produced large spurious readings (e.g. tooltip showing 69% when
  // cursor.com showed <1%). If the percent fields are truly missing we'd
  // rather fail loudly than misinterpret a count as a percent.
  const autoPct = normalizePercent(
    pickFirst(planSource, [
      "autoPercentUsed",
      "autoPercentageUsed",
      "autoUsedPercent",
    ]),
  );
  const apiPct = normalizePercent(
    pickFirst(planSource, [
      "apiPercentUsed",
      "apiPercentageUsed",
      "apiUsedPercent",
    ]),
  );
  const totalPct = normalizePercent(
    pickFirst(planSource, [
      "totalPercentUsed",
      "totalPercentageUsed",
      "totalUsedPercent",
      "overallPercentUsed",
    ]),
  );

  if (autoPct === null && apiPct === null && totalPct === null) {
    throw new Error(
      "Usage summary response is missing autoPercentUsed/apiPercentUsed/totalPercentUsed",
    );
  }

  return {
    billingCycle: { startMs, endMs },
    plan: {
      autoPercentUsed: autoPct ?? 0,
      apiPercentUsed: apiPct ?? 0,
      totalPercentUsed:
        totalPct ?? combinedTotal(autoPct, apiPct),
    },
    raw,
  };
}

function findPlanLikeContainer(
  root: Record<string, unknown>,
): Record<string, unknown> {
  const direct = root["plan"];
  if (isPlanShape(direct)) {
    return direct as Record<string, unknown>;
  }
  const individual = root["individualUsage"];
  if (typeof individual === "object" && individual !== null) {
    const plan = (individual as Record<string, unknown>)["plan"];
    if (isPlanShape(plan)) {
      return plan as Record<string, unknown>;
    }
    if (isPlanShape(individual)) {
      return individual as Record<string, unknown>;
    }
  }
  if (isPlanShape(root)) {
    return root;
  }
  return {};
}

function isPlanShape(candidate: unknown): boolean {
  if (typeof candidate !== "object" || candidate === null) return false;
  const c = candidate as Record<string, unknown>;
  return (
    "autoPercentUsed" in c ||
    "apiPercentUsed" in c ||
    "totalPercentUsed" in c ||
    "autoPercentageUsed" in c ||
    "apiPercentageUsed" in c
  );
}

function pickFirst(
  obj: Record<string, unknown>,
  keys: string[],
): unknown {
  for (const key of keys) {
    if (key in obj) {
      const value = obj[key];
      if (value !== undefined && value !== null) {
        return value;
      }
    }
  }
  return undefined;
}

function parseDate(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value < 1e12 ? value * 1000 : value;
  }
  if (typeof value === "string" && value.length > 0) {
    const ms = Date.parse(value);
    return Number.isFinite(ms) ? ms : null;
  }
  return null;
}

function normalizePercent(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0) return 0;
  return value;
}

function combinedTotal(auto: number | null, api: number | null): number {
  return (auto ?? 0) + (api ?? 0);
}
