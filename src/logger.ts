import * as vscode from "vscode";

/**
 * Single output-channel logger. Never logs access tokens, session cookies, or
 * other credential material.
 */
// Defensive cap. After the allow-list filter the body is tiny, but keep this
// in case `teamUsage` ever contains many entries.
const RAW_BODY_MAX_CHARS = 8_000;

export class Logger {
  private readonly channel: vscode.OutputChannel;
  private lastError: string | undefined;
  private lastResponseSummary: string | undefined;
  private lastRawBody: string | undefined;

  constructor(name: string) {
    this.channel = vscode.window.createOutputChannel(name);
  }

  log(message: string): void {
    this.channel.appendLine(`[${timestamp()}] ${message}`);
  }

  recordError(message: string, cause?: unknown): void {
    const causeText = formatCause(cause);
    const fullMessage = causeText ? `${message}\n  ↳ ${causeText}` : message;
    this.lastError = `[${timestamp()}] ${fullMessage}`;
    this.log(`ERROR: ${fullMessage}`);
  }

  recordResponseSummary(summary: string): void {
    this.lastResponseSummary = `[${timestamp()}] ${summary}`;
    this.log(`OK: ${summary}`);
  }

  // Captures the decoded JSON body so the *Show logs* view can surface what
  // Cursor's `usage-summary` endpoint returned.
  // The body is sanitized through an allow-list before logging: only the
  // billing-cycle, plan, and on-demand usage fields are kept. Anything else
  // the endpoint returns (or may start returning) is dropped.
  recordRawResponse(raw: unknown): void {
    const sanitized = sanitizeUsageBody(raw);
    const serialized = safeStringify(sanitized);
    const truncated = truncate(serialized, RAW_BODY_MAX_CHARS);
    this.lastRawBody = truncated;
    this.channel.appendLine(`[${timestamp()}] RAW: ${truncated}`);
  }

  show(): void {
    this.channel.appendLine("");
    this.channel.appendLine("--- Logs snapshot ---");
    this.channel.appendLine(`Last response: ${this.lastResponseSummary ?? "(none)"}`);
    this.channel.appendLine(`Last error:    ${this.lastError ?? "(none)"}`);
    this.channel.appendLine("Last raw body:");
    this.channel.appendLine(this.lastRawBody ?? "(none)");
    this.channel.appendLine("---------------------");
    this.channel.show(true);
  }

  dispose(): void {
    this.channel.dispose();
  }
}

export function sanitizeUsageBody(raw: unknown): unknown {
  if (!isObject(raw)) return null;
  const r = raw as Record<string, unknown>;
  const out: Record<string, unknown> = {
    billingCycleStart: asString(r.billingCycleStart),
    billingCycleEnd: asString(r.billingCycleEnd),
    limitType: asString(r.limitType),
    isUnlimited: asBoolean(r.isUnlimited),
    individualUsage: sanitizeUsageBlock(r.individualUsage),
    teamUsage: sanitizeUsageBlock(r.teamUsage),
  };
  return out;
}

function sanitizeUsageBlock(value: unknown): Record<string, unknown> {
  if (!isObject(value)) return {};
  const obj = value as Record<string, unknown>;
  const out: Record<string, unknown> = {
    plan: sanitizePlan(obj.plan),
    onDemand: sanitizeOnDemand(obj.onDemand),
  };
  return out;
}

function sanitizePlan(value: unknown): Record<string, unknown> {
  if (!isObject(value)) return {};
  const out: Record<string, unknown> = {
    enabled: asBoolean(value.enabled),
    used: asNumber(value.used),
    limit: asNumber(value.limit),
    remaining: asNumber(value.remaining),
    breakdown: sanitizeBreakdown(value.breakdown),
    autoPercentUsed: asNumber(value.autoPercentUsed),
    apiPercentUsed: asNumber(value.apiPercentUsed),
    totalPercentUsed: asNumber(value.totalPercentUsed),
  };
  return out;
}

function sanitizeBreakdown(value: unknown): Record<string, unknown> {
  if (!isObject(value)) return {};
  const out: Record<string, unknown> = {
    included: asNumber(value.included),
    bonus: asNumber(value.bonus),
    total: asNumber(value.total),
  };
  return out;
}

function sanitizeOnDemand(value: unknown): Record<string, unknown> {
  if (!isObject(value)) return {};
  const out: Record<string, unknown> = {
    enabled: asBoolean(value.enabled),
    used: asNumber(value.used),
    limit: asNumber(value.limit),
    remaining: asNumber(value.remaining),
  };
  return out;
}

function asNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asBoolean(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

function truncate(text: string, max: number): string {
  if (text.length <= max) return text;
  return `${text.slice(0, max)}\n… (${text.length - max} more chars truncated)`;
}

function timestamp(): string {
  return new Date().toISOString();
}

function formatCause(cause: unknown): string | undefined {
  if (cause === undefined || cause === null) return undefined;
  if (cause instanceof Error) {
    const code = (cause as NodeJS.ErrnoException).code;
    const codeText = code ? ` [${code}]` : "";
    return `${cause.name}${codeText}: ${cause.message}`;
  }
  return String(cause);
}
