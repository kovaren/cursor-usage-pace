import { describe, expect, it } from "vitest";
import { fetchUsageSummary, parseUsageSummary } from "./usageClient";

describe("parseUsageSummary", () => {
  it("parses the documented numanaral shape", () => {
    const summary = parseUsageSummary({
      billingCycleStart: "2026-04-04T00:00:00.000Z",
      billingCycleEnd: "2026-05-04T00:00:00.000Z",
      individualUsage: {
        plan: {
          autoPercentUsed: 12,
          apiPercentUsed: 38,
          totalPercentUsed: 17,
        },
      },
    });
    expect(summary.billingCycle.startMs).toBe(
      Date.parse("2026-04-04T00:00:00.000Z"),
    );
    expect(summary.billingCycle.endMs).toBe(
      Date.parse("2026-05-04T00:00:00.000Z"),
    );
    expect(summary.plan.autoPercentUsed).toBe(12);
    expect(summary.plan.apiPercentUsed).toBe(38);
    expect(summary.plan.totalPercentUsed).toBe(17);
  });

  it("normalizes 0..1 fractional percentages to 0..100", () => {
    const summary = parseUsageSummary({
      billingCycleStart: "2026-04-04T00:00:00.000Z",
      billingCycleEnd: "2026-05-04T00:00:00.000Z",
      plan: {
        autoPercentUsed: 0.12,
        apiPercentUsed: 0.38,
        totalPercentUsed: 0.17,
      },
    });
    expect(summary.plan.autoPercentUsed).toBeCloseTo(12, 5);
    expect(summary.plan.apiPercentUsed).toBeCloseTo(38, 5);
    expect(summary.plan.totalPercentUsed).toBeCloseTo(17, 5);
  });

  it("falls back to summed auto+api when total is missing", () => {
    const summary = parseUsageSummary({
      billingCycleStart: "2026-04-04T00:00:00.000Z",
      billingCycleEnd: "2026-05-04T00:00:00.000Z",
      plan: {
        autoPercentUsed: 12,
        apiPercentUsed: 38,
      },
    });
    expect(summary.plan.totalPercentUsed).toBe(50);
  });

  it("accepts numeric (epoch seconds) cycle dates", () => {
    const startSec = 1_711_929_600;
    const endSec = 1_714_521_600;
    const summary = parseUsageSummary({
      billingCycleStart: startSec,
      billingCycleEnd: endSec,
      plan: { autoPercentUsed: 1, apiPercentUsed: 2, totalPercentUsed: 3 },
    });
    expect(summary.billingCycle.startMs).toBe(startSec * 1000);
    expect(summary.billingCycle.endMs).toBe(endSec * 1000);
  });

  it("throws when cycle dates are missing", () => {
    expect(() =>
      parseUsageSummary({
        plan: { autoPercentUsed: 1, apiPercentUsed: 2, totalPercentUsed: 3 },
      }),
    ).toThrow(/billing cycle/i);
  });

  it("throws when usage percentages are entirely missing", () => {
    expect(() =>
      parseUsageSummary({
        billingCycleStart: "2026-04-04T00:00:00.000Z",
        billingCycleEnd: "2026-05-04T00:00:00.000Z",
        plan: {},
      }),
    ).toThrow(/PercentUsed/);
  });
});

describe("fetchUsageSummary", () => {
  const baseOpts = {
    cookieValue: "user_abc::token",
    userAgent: "test-agent/1.0",
    baseUrl: "https://example.test",
  };

  it("sends the cookie and user agent and returns parsed body", async () => {
    let capturedUrl = "";
    let capturedHeaders: Record<string, string> = {};
    const fetchImpl = (async (
      url: string,
      init: RequestInit,
    ): Promise<Response> => {
      capturedUrl = url;
      capturedHeaders = init.headers as Record<string, string>;
      return new Response(
        JSON.stringify({
          billingCycleStart: "2026-04-04T00:00:00.000Z",
          billingCycleEnd: "2026-05-04T00:00:00.000Z",
          plan: { autoPercentUsed: 12, apiPercentUsed: 38, totalPercentUsed: 17 },
        }),
        { status: 200, headers: { "Content-Type": "application/json" } },
      );
    }) as typeof fetch;

    const result = await fetchUsageSummary({ ...baseOpts, fetchImpl });
    expect(result.ok).toBe(true);
    expect(capturedUrl).toBe("https://example.test/api/usage-summary");
    expect(capturedHeaders.Cookie).toBe(
      "WorkosCursorSessionToken=user_abc::token",
    );
    expect(capturedHeaders["User-Agent"]).toBe("test-agent/1.0");
  });

  it("returns unauthorized on 401", async () => {
    const fetchImpl = (async () =>
      new Response("nope", { status: 401 })) as typeof fetch;
    const result = await fetchUsageSummary({ ...baseOpts, fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("unauthorized");
      expect(result.status).toBe(401);
    }
  });

  it("returns unauthorized on 403", async () => {
    const fetchImpl = (async () =>
      new Response("nope", { status: 403 })) as typeof fetch;
    const result = await fetchUsageSummary({ ...baseOpts, fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("unauthorized");
  });

  it("returns http on 5xx", async () => {
    const fetchImpl = (async () =>
      new Response("oops", { status: 503, statusText: "Service Unavailable" })) as typeof fetch;
    const result = await fetchUsageSummary({ ...baseOpts, fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("http");
      expect(result.status).toBe(503);
    }
  });

  it("returns network on fetch rejection", async () => {
    const fetchImpl = (async () => {
      throw new Error("connection refused");
    }) as typeof fetch;
    const result = await fetchUsageSummary({ ...baseOpts, fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toBe("network");
      expect(result.message).toContain("connection refused");
    }
  });

  it("returns parse on invalid JSON", async () => {
    const fetchImpl = (async () =>
      new Response("not json", { status: 200 })) as typeof fetch;
    const result = await fetchUsageSummary({ ...baseOpts, fetchImpl });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("parse");
  });

  it("returns timeout when the request is aborted", async () => {
    const fetchImpl = ((
      _url: string,
      init: RequestInit,
    ): Promise<Response> => {
      return new Promise((_resolve, reject) => {
        init.signal?.addEventListener("abort", () => {
          const err = new Error("aborted") as Error & { name: string };
          err.name = "AbortError";
          reject(err);
        });
      });
    }) as typeof fetch;
    const result = await fetchUsageSummary({
      ...baseOpts,
      fetchImpl,
      timeoutMs: 5,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("timeout");
  });
});
