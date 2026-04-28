import * as crypto from "crypto";
import * as vscode from "vscode";
import { buildSessionCookieValue } from "./auth/jwt";
import { resolveStateDbPath } from "./auth/statePath";
import {
  TokenReadError,
  readAccessTokenWithStrategy,
} from "./auth/tokenReader";
import {
  UsageFetchResult,
  UsageSummary,
  fetchUsageSummary,
} from "./api/usageClient";
import { buildPaceModel } from "./pace/model";
import { SummaryCache } from "./state/cache";
import { Diagnostics } from "./diagnostics";
import { PaceStatusBar } from "./ui/statusBar";
import {
  TooltipCommands,
  buildErrorTooltip,
  buildPaceTooltip,
  buildSignedOutTooltip,
} from "./ui/tooltip";
import { ResolvedConfig, readConfig } from "./config";

const USER_AGENT_BASE = "cursor-usage-pace";

const TOOLTIP_REFRESH_INTERVAL_MS = 30_000;

type DisplayType = "loading" | "data" | "signedOut" | "error";

/**
 * `string` = a hash of the locally-stored access token.
 * `null`   = no usable token in the DB (signed out).
 * `undefined` = DB was not read at yet (startup).
 */
type TokenFingerprint = string | null | undefined;

export class PaceController implements vscode.Disposable {
  private timer: NodeJS.Timeout | undefined;
  private tooltipTimer: NodeJS.Timeout | undefined;
  private inFlight: Promise<void> | undefined;
  private currentConfig: ResolvedConfig;
  private currentState: DisplayType = "loading";
  private lastTokenFingerprint: TokenFingerprint = undefined;

  constructor(
    private readonly statusBar: PaceStatusBar,
    private readonly cache: SummaryCache,
    private readonly diagnostics: Diagnostics,
    private readonly tooltipCommands: TooltipCommands,
    private readonly extensionVersion: string,
  ) {
    this.currentConfig = readConfig();
  }

  start(): void {
    this.statusBar.render({ kind: "loading" });
    this.currentState = "loading";
    this.scheduleNext(0);
    this.tooltipTimer = setInterval(
      () => void this.refreshTooltip(),
      TOOLTIP_REFRESH_INTERVAL_MS,
    );
  }

  async refresh(options: { showLoading?: boolean } = {}): Promise<void> {
    if (this.inFlight) return this.inFlight;
    const showLoading = options.showLoading ?? false;
    this.inFlight = this.runRefresh(showLoading);
    try {
      await this.inFlight;
    } finally {
      this.inFlight = undefined;
    }
  }

  onConfigurationChanged(): void {
    const next = readConfig();
    const intervalChanged =
      next.refreshIntervalMs !== this.currentConfig.refreshIntervalMs;
    this.currentConfig = next;
    if (intervalChanged) {
      this.scheduleNext(this.currentConfig.refreshIntervalMs);
    }
    void this.renderFromCacheOrLoading();
  }

  /**
   * Cheap re-read after the editor regains focus (e.g. browser sign-in
   * completes)
   */
  checkForAuthChange(): void {
    let next: TokenFingerprint;
    try {
      const dbPath = resolveStateDbPath(this.currentConfig.stateDbPath);
      const result = readAccessTokenWithStrategy(dbPath);
      next = fingerprintToken(result.token);
    } catch (err) {
      if (
        err instanceof TokenReadError &&
        (err.kind === "dbMissing" ||
          err.kind === "tokenMissing" ||
          err.kind === "tokenEmpty")
      ) {
        next = null;
      } else {
        // Transient read error — periodic refresh handles it later.
        return;
      }
    }

    const prev = this.lastTokenFingerprint;
    this.lastTokenFingerprint = next;

    if (prev === undefined) {
      // start() drives the first refresh — avoid doubling up.
      return;
    }
    if (next === null || prev === next) {
      return;
    }

    this.diagnostics.log("Token appeared or rotated after focus; refreshing");
    void this.refresh();
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    if (this.tooltipTimer) {
      clearInterval(this.tooltipTimer);
      this.tooltipTimer = undefined;
    }
  }

  private async runRefresh(showLoading: boolean): Promise<void> {
    const cfg = this.currentConfig;
    if (showLoading) {
      this.statusBar.render({ kind: "loading", preserveLabel: true });
      this.currentState = "loading";
    }
    this.diagnostics.log(
      `Refreshing (interval=${cfg.refreshIntervalMs / 60000}m, show=${cfg.show})`,
    );

    let token: string;
    try {
      const dbPath = resolveStateDbPath(cfg.stateDbPath);
      this.diagnostics.log(`Reading token from ${dbPath}`);
      const result = readAccessTokenWithStrategy(dbPath, {
        log: (msg) => this.diagnostics.log(`  ${msg}`),
      });
      this.diagnostics.log(`Token read via ${result.strategy}`);
      token = result.token;
      this.lastTokenFingerprint = fingerprintToken(token);
    } catch (err) {
      if (err instanceof TokenReadError) {
        this.diagnostics.recordError(
          `Token read failed: ${err.kind} — ${err.message}`,
          (err as Error & { cause?: unknown }).cause,
        );
        if (err.kind === "dbMissing" || err.kind === "tokenMissing" || err.kind === "tokenEmpty") {
          this.lastTokenFingerprint = null;
          void this.cache.clear();
          this.renderSignedOut();
        } else {
          this.renderError(err.message);
        }
      } else {
        const message = (err as Error).message ?? String(err);
        this.diagnostics.recordError(`Unexpected token read error: ${message}`, err);
        this.renderError(message);
      }
      this.scheduleNext(cfg.refreshIntervalMs);
      return;
    }

    let cookieValue: string;
    try {
      cookieValue = buildSessionCookieValue(token);
    } catch (err) {
      const message = (err as Error).message ?? String(err);
      this.diagnostics.recordError(
        `Could not parse access token: ${message}`,
      );
      this.renderSignedOut();
      this.scheduleNext(cfg.refreshIntervalMs);
      return;
    }

    const result = await fetchUsageSummary({
      cookieValue,
      userAgent: `${USER_AGENT_BASE}/${this.extensionVersion}`,
    });
    this.handleResult(result);
    this.scheduleNext(cfg.refreshIntervalMs);
  }

  private handleResult(result: UsageFetchResult): void {
    const now = Date.now();
    if (result.ok) {
      void this.cache.write(result.summary, now);
      this.diagnostics.recordResponseSummary(
        `auto=${result.summary.plan.autoPercentUsed.toFixed(1)}% ` +
          `api=${result.summary.plan.apiPercentUsed.toFixed(1)}% ` +
          `cycle=${new Date(result.summary.billingCycle.startMs).toISOString().slice(0, 10)}` +
          `→${new Date(result.summary.billingCycle.endMs).toISOString().slice(0, 10)}`,
      );
      this.renderModel(result.summary, now, now);
      return;
    }

    this.diagnostics.recordError(
      `Fetch failed: ${result.reason}${result.status ? ` (${result.status})` : ""} — ${result.message}`,
    );

    if (result.reason === "unauthorized") {
      void this.cache.clear();
      this.renderSignedOut();
      return;
    }

    const cached = this.cache.read();
    if (cached) {
      this.renderModel(cached.summary, cached.fetchedAtMs, now, {
        forceStale: true,
      });
      return;
    }
    this.renderError(`${result.reason}: ${result.message}`);
  }

  private renderModel(
    summary: UsageSummary,
    fetchedAtMs: number,
    nowMs: number,
    options: { forceStale?: boolean } = {},
  ): void {
    const cfg = this.currentConfig;
    const staleAfterMs = Math.max(cfg.refreshIntervalMs * 2, 60_000);
    const model = buildPaceModel({
      summary,
      fetchedAtMs,
      nowMs,
      show: cfg.show,
      onPaceThresholdPp: cfg.onPaceThresholdPp,
      staleAfterMs,
      forceStale: options.forceStale,
    });
    const tooltip = buildPaceTooltip(model, this.tooltipCommands, nowMs);
    this.statusBar.render({ kind: "data", model, tooltip });
    this.currentState = "data";
  }

  private renderSignedOut(): void {
    this.statusBar.render({
      kind: "signedOut",
      tooltip: buildSignedOutTooltip(this.tooltipCommands),
    });
    this.currentState = "signedOut";
  }

  private renderError(message: string): void {
    this.statusBar.render({
      kind: "error",
      message,
      tooltip: buildErrorTooltip(message, this.tooltipCommands),
    });
    this.currentState = "error";
  }

  private refreshTooltip(): void {
    if (this.currentState !== "data") return;
    const cached = this.cache.read();
    if (cached) {
      this.renderModel(cached.summary, cached.fetchedAtMs, Date.now());
    }
  }

  private async renderFromCacheOrLoading(): Promise<void> {
    if (this.currentState === "signedOut" || this.currentState === "error") {
      return;
    }
    const cached = this.cache.read();
    if (cached) {
      this.renderModel(cached.summary, cached.fetchedAtMs, Date.now());
    } else {
      this.statusBar.render({ kind: "loading" });
      this.currentState = "loading";
    }
  }

  private scheduleNext(delayMs: number): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    if (delayMs <= 0) {
      this.timer = setTimeout(() => void this.refresh(), 0);
      return;
    }
    this.timer = setTimeout(() => void this.refresh(), delayMs);
  }
}

function fingerprintToken(token: string): string {
  return crypto.createHash("sha256").update(token).digest("hex").slice(0, 16);
}
