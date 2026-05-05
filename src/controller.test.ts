import { beforeEach, describe, expect, it, vi } from "vitest";
import * as vscode from "vscode";
import { TokenReadError } from "./auth/tokenReader";
import { PaceController } from "./controller";
import { SummaryCache } from "./state/cache";
import type { Logger } from "./logger";
import type { PaceStatusBar, StatusBarState } from "./ui/statusBar";
import type {
  UsageFetchResult,
  UsageSummary,
} from "./api/usageClient";

vi.mock("./auth/tokenReader", async () => {
  const actual = await vi.importActual<typeof import("./auth/tokenReader")>(
    "./auth/tokenReader",
  );
  return {
    ...actual,
    readAccessTokenWithStrategy: vi.fn(),
  };
});

vi.mock("./api/usageClient", async () => {
  const actual = await vi.importActual<typeof import("./api/usageClient")>(
    "./api/usageClient",
  );
  return {
    ...actual,
    fetchUsageSummary: vi.fn(),
  };
});

import { readAccessTokenWithStrategy } from "./auth/tokenReader";
import { fetchUsageSummary } from "./api/usageClient";

const mockReadToken = readAccessTokenWithStrategy as unknown as ReturnType<
  typeof vi.fn
>;
const mockFetch = fetchUsageSummary as unknown as ReturnType<typeof vi.fn>;

const SUMMARY: UsageSummary = {
  billingCycle: {
    startMs: Date.parse("2026-04-04T00:00:00.000Z"),
    endMs: Date.parse("2026-05-04T00:00:00.000Z"),
  },
  plan: { autoPercentUsed: 12, apiPercentUsed: 38, totalPercentUsed: 17 },
  raw: undefined,
};

class FakeStatusBar {
  states: StatusBarState[] = [];
  render(state: StatusBarState): void {
    this.states.push(state);
  }
  dispose(): void {
    // intentionally empty
  }
  get last(): StatusBarState | undefined {
    return this.states[this.states.length - 1];
  }
}

class FakeMemento {
  private store = new Map<string, unknown>();
  get<T>(key: string, defaultValue?: T): T | undefined {
    if (this.store.has(key)) return this.store.get(key) as T;
    return defaultValue;
  }
  update(key: string, value: unknown): Thenable<void> {
    if (value === undefined) this.store.delete(key);
    else this.store.set(key, value);
    return Promise.resolve();
  }
  keys(): readonly string[] {
    return Array.from(this.store.keys());
  }
}

interface Harness {
  controller: PaceController;
  bar: FakeStatusBar;
  cache: SummaryCache;
  logger: Logger;
}

function makeHarness(seed?: { fetchedAtMs: number }): Harness {
  const bar = new FakeStatusBar();
  const memento = new FakeMemento();
  const cache = new SummaryCache(memento as unknown as vscode.Memento);
  if (seed) {
    void cache.write(SUMMARY, seed.fetchedAtMs);
  }
  const logger = {
    log: vi.fn(),
    recordError: vi.fn(),
    recordResponseSummary: vi.fn(),
    recordRawResponse: vi.fn(),
  } as unknown as Logger;
  const controller = new PaceController(
    bar as unknown as PaceStatusBar,
    cache,
    logger,
    {
      refresh: "cmd.refresh",
      openDashboard: "cmd.dashboard",
      showLogs: "cmd.logs",
    },
    "test",
  );
  return { controller, bar, cache, logger };
}

function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

function makeFakeJwt(sub: string): string {
  const header = Buffer.from(JSON.stringify({ alg: "none" })).toString(
    "base64url",
  );
  const payload = Buffer.from(JSON.stringify({ sub })).toString("base64url");
  return `${header}.${payload}.sig`;
}

const FAKE_TOKEN = makeFakeJwt("user_test_123");

beforeEach(() => {
  mockReadToken.mockReset();
  mockFetch.mockReset();
});

describe("PaceController — sign-out path", () => {
  it("clears the cache when token read fails as a sign-out (dbMissing)", async () => {
    const harness = makeHarness({ fetchedAtMs: Date.now() - 60_000 });
    expect(harness.cache.read()).toBeDefined();

    mockReadToken.mockImplementation(() => {
      throw new TokenReadError("missing", "dbMissing");
    });

    await harness.controller.refresh();
    await flushPromises();

    expect(harness.cache.read()).toBeUndefined();
    expect(harness.bar.last?.kind).toBe("signedOut");

    harness.controller.dispose();
  });

  it("clears the cache when the stored token is empty (tokenEmpty)", async () => {
    const harness = makeHarness({ fetchedAtMs: Date.now() - 60_000 });

    mockReadToken.mockImplementation(() => {
      throw new TokenReadError("empty", "tokenEmpty");
    });

    await harness.controller.refresh();
    await flushPromises();

    expect(harness.cache.read()).toBeUndefined();
    expect(harness.bar.last?.kind).toBe("signedOut");

    harness.controller.dispose();
  });

  it("does NOT render signed-out for unrelated db errors (dbUnreadable)", async () => {
    const harness = makeHarness({ fetchedAtMs: Date.now() - 60_000 });

    mockReadToken.mockImplementation(() => {
      throw new TokenReadError("perms", "dbUnreadable");
    });

    await harness.controller.refresh();
    await flushPromises();

    expect(harness.bar.last?.kind).toBe("error");
    // Cache should be preserved across transient read errors so the user
    // doesn't lose their last good numbers on a one-off disk hiccup.
    expect(harness.cache.read()).toBeDefined();

    harness.controller.dispose();
  });

  it("tooltip refresh does not resurrect cached data while signed out", async () => {
    const harness = makeHarness({ fetchedAtMs: Date.now() - 60_000 });

    mockReadToken.mockImplementation(() => {
      throw new TokenReadError("missing", "dbMissing");
    });

    await harness.controller.refresh();
    await flushPromises();
    expect(harness.bar.last?.kind).toBe("signedOut");

    // Hostile race: simulate something writing a value back into the cache
    // after we transitioned to signed-out (e.g. a queued write completing).
    await harness.cache.write(SUMMARY, Date.now());
    expect(harness.cache.read()).toBeDefined();

    const before = harness.bar.states.length;
    (harness.controller as unknown as { refreshTooltip(): void }).refreshTooltip();

    expect(harness.bar.states.length).toBe(before);
    expect(harness.bar.last?.kind).toBe("signedOut");

    harness.controller.dispose();
  });

  it("config-change re-render does not resurrect cached data while signed out", async () => {
    const harness = makeHarness({ fetchedAtMs: Date.now() - 60_000 });

    mockReadToken.mockImplementation(() => {
      throw new TokenReadError("missing", "dbMissing");
    });

    await harness.controller.refresh();
    await flushPromises();

    await harness.cache.write(SUMMARY, Date.now());

    const before = harness.bar.states.length;
    harness.controller.onConfigurationChanged();
    await flushPromises();

    expect(harness.bar.states.length).toBe(before);
    expect(harness.bar.last?.kind).toBe("signedOut");

    harness.controller.dispose();
  });
});

describe("PaceController — offline / cache fallback", () => {
  it("marks the cached fallback as stale even when the cache is fresh", async () => {
    const harness = makeHarness({ fetchedAtMs: Date.now() - 30_000 });

    mockReadToken.mockReturnValue({
      token: FAKE_TOKEN,
      strategy: "better-sqlite3",
    });
    mockFetch.mockResolvedValue({
      ok: false,
      reason: "network",
      message: "ENETUNREACH",
    } satisfies UsageFetchResult);

    await harness.controller.refresh();
    await flushPromises();

    const last = harness.bar.last;
    expect(last?.kind).toBe("data");
    if (last?.kind === "data") {
      expect(last.model.isStale).toBe(true);
    }
    expect(harness.cache.read()).toBeDefined();

    harness.controller.dispose();
  });

  it("renders fresh data without the stale flag on success", async () => {
    const harness = makeHarness();

    mockReadToken.mockReturnValue({
      token: FAKE_TOKEN,
      strategy: "better-sqlite3",
    });
    mockFetch.mockResolvedValue({
      ok: true,
      summary: SUMMARY,
    });

    await harness.controller.refresh();
    await flushPromises();

    const last = harness.bar.last;
    expect(last?.kind).toBe("data");
    if (last?.kind === "data") {
      expect(last.model.isStale).toBe(false);
    }

    harness.controller.dispose();
  });

  it("falls through to error when the fetch fails and there is no cache", async () => {
    const harness = makeHarness();

    mockReadToken.mockReturnValue({
      token: FAKE_TOKEN,
      strategy: "better-sqlite3",
    });
    mockFetch.mockResolvedValue({
      ok: false,
      reason: "network",
      message: "ENETUNREACH",
    } satisfies UsageFetchResult);

    await harness.controller.refresh();
    await flushPromises();

    expect(harness.bar.last?.kind).toBe("error");

    harness.controller.dispose();
  });

  it("clears the cache and signs out when the server returns 401", async () => {
    const harness = makeHarness({ fetchedAtMs: Date.now() - 60_000 });

    mockReadToken.mockReturnValue({
      token: FAKE_TOKEN,
      strategy: "better-sqlite3",
    });
    mockFetch.mockResolvedValue({
      ok: false,
      reason: "unauthorized",
      status: 401,
      message: "Cursor rejected the session token. Try signing back in.",
    } satisfies UsageFetchResult);

    await harness.controller.refresh();
    await flushPromises();

    expect(harness.bar.last?.kind).toBe("signedOut");
    expect(harness.cache.read()).toBeUndefined();

    harness.controller.dispose();
  });
});

describe("PaceController — checkForAuthChange", () => {
  const TOKEN_A = makeFakeJwt("user_a");
  const TOKEN_B = makeFakeJwt("user_b");

  async function settleInitial(harness: Harness): Promise<void> {
    await harness.controller.refresh();
    await flushPromises();
  }

  it("triggers a refresh when a new token replaces the previous one", async () => {
    const harness = makeHarness();
    mockReadToken.mockReturnValue({ token: TOKEN_A, strategy: "better-sqlite3" });
    mockFetch.mockResolvedValue({ ok: true, summary: SUMMARY });
    await settleInitial(harness);

    const fetchCallsBefore = mockFetch.mock.calls.length;
    mockReadToken.mockReturnValue({ token: TOKEN_B, strategy: "better-sqlite3" });

    harness.controller.checkForAuthChange();
    await flushPromises();

    expect(mockFetch.mock.calls.length).toBeGreaterThan(fetchCallsBefore);

    harness.controller.dispose();
  });

  it("does not trigger a refresh when the token is unchanged", async () => {
    const harness = makeHarness();
    mockReadToken.mockReturnValue({ token: TOKEN_A, strategy: "better-sqlite3" });
    mockFetch.mockResolvedValue({ ok: true, summary: SUMMARY });
    await settleInitial(harness);

    const fetchCallsBefore = mockFetch.mock.calls.length;

    harness.controller.checkForAuthChange();
    await flushPromises();

    expect(mockFetch.mock.calls.length).toBe(fetchCallsBefore);

    harness.controller.dispose();
  });

  it("does not refresh on focus probe when token disappears (sign-out path is interval-only)", async () => {
    const harness = makeHarness();
    mockReadToken.mockReturnValue({ token: TOKEN_A, strategy: "better-sqlite3" });
    mockFetch.mockResolvedValue({ ok: true, summary: SUMMARY });
    await settleInitial(harness);
    expect(harness.bar.last?.kind).toBe("data");

    mockReadToken.mockImplementation(() => {
      throw new TokenReadError("missing", "tokenMissing");
    });

    const fetchCallsBefore = mockFetch.mock.calls.length;

    harness.controller.checkForAuthChange();
    await flushPromises();

    expect(mockFetch.mock.calls.length).toBe(fetchCallsBefore);
    expect(harness.bar.last?.kind).toBe("data");

    harness.controller.dispose();
  });

  it("triggers a refresh when the user signs back in (token reappears)", async () => {
    const harness = makeHarness();
    mockReadToken.mockImplementation(() => {
      throw new TokenReadError("missing", "dbMissing");
    });
    await settleInitial(harness);
    expect(harness.bar.last?.kind).toBe("signedOut");

    mockReadToken.mockReturnValue({ token: TOKEN_A, strategy: "better-sqlite3" });
    mockFetch.mockResolvedValue({ ok: true, summary: SUMMARY });

    harness.controller.checkForAuthChange();
    await flushPromises();

    expect(harness.bar.last?.kind).toBe("data");

    harness.controller.dispose();
  });

  it("ignores transient read errors so disk hiccups do not flap the bar", async () => {
    const harness = makeHarness();
    mockReadToken.mockReturnValue({ token: TOKEN_A, strategy: "better-sqlite3" });
    mockFetch.mockResolvedValue({ ok: true, summary: SUMMARY });
    await settleInitial(harness);

    const fetchCallsBefore = mockFetch.mock.calls.length;
    mockReadToken.mockImplementation(() => {
      throw new TokenReadError("perms", "dbUnreadable");
    });

    harness.controller.checkForAuthChange();
    await flushPromises();

    expect(mockFetch.mock.calls.length).toBe(fetchCallsBefore);
    expect(harness.bar.last?.kind).toBe("data");

    harness.controller.dispose();
  });
});

describe("PaceController — tooltip tick", () => {
  it("re-renders cached data while in data state", async () => {
    const harness = makeHarness();

    mockReadToken.mockReturnValue({
      token: FAKE_TOKEN,
      strategy: "better-sqlite3",
    });
    mockFetch.mockResolvedValue({
      ok: true,
      summary: SUMMARY,
    });

    await harness.controller.refresh();
    await flushPromises();
    expect(harness.bar.last?.kind).toBe("data");

    const before = harness.bar.states.length;
    (harness.controller as unknown as { refreshTooltip(): void }).refreshTooltip();

    expect(harness.bar.states.length).toBe(before + 1);
    expect(harness.bar.last?.kind).toBe("data");

    harness.controller.dispose();
  });

  it("does nothing when the bar is in error state", async () => {
    const harness = makeHarness();

    mockReadToken.mockReturnValue({
      token: FAKE_TOKEN,
      strategy: "better-sqlite3",
    });
    mockFetch.mockResolvedValue({
      ok: false,
      reason: "network",
      message: "ENETUNREACH",
    } satisfies UsageFetchResult);

    await harness.controller.refresh();
    await flushPromises();
    expect(harness.bar.last?.kind).toBe("error");

    // Hostile race: write a cache entry as if a parallel path stashed one.
    await harness.cache.write(SUMMARY, Date.now());

    const before = harness.bar.states.length;
    (harness.controller as unknown as { refreshTooltip(): void }).refreshTooltip();

    expect(harness.bar.states.length).toBe(before);
    expect(harness.bar.last?.kind).toBe("error");

    harness.controller.dispose();
  });
});
