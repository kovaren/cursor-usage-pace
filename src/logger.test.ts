import { describe, expect, it } from "vitest";
import { sanitizeUsageBody } from "./logger";

describe("sanitizeUsageBody", () => {
  it("keeps the documented usage fields and drops everything else", () => {
    const raw = {
      billingCycleStart: "2026-05-04T20:27:12.000Z",
      billingCycleEnd: "2026-06-04T20:27:12.000Z",
      limitType: "user",
      isUnlimited: false,
      individualUsage: {
        plan: {
          enabled: true,
          used: 906,
          limit: 7000,
          remaining: 6094,
          breakdown: { included: 906, bonus: 0, total: 906 },
          autoPercentUsed: 0.71,
          apiPercentUsed: 5.65,
          totalPercentUsed: 1.77,
        },
        onDemand: { enabled: false, used: 0, limit: null, remaining: null },
      },
      teamUsage: {},
    };

    expect(sanitizeUsageBody(raw)).toEqual({
      billingCycleStart: "2026-05-04T20:27:12.000Z",
      billingCycleEnd: "2026-06-04T20:27:12.000Z",
      limitType: "user",
      isUnlimited: false,
      individualUsage: {
        plan: {
          enabled: true,
          used: 906,
          limit: 7000,
          remaining: 6094,
          breakdown: { included: 906, bonus: 0, total: 906 },
          autoPercentUsed: 0.71,
          apiPercentUsed: 5.65,
          totalPercentUsed: 1.77,
        },
        onDemand: { enabled: false, used: 0, limit: null, remaining: null },
      },
      teamUsage: { plan: {}, onDemand: {} },
    });
  });

  it("drops unknown top-level fields, including credential-shaped ones", () => {
    const raw = {
      billingCycleStart: "2026-05-04T20:27:12.000Z",
      billingCycleEnd: "2026-06-04T20:27:12.000Z",
      // Hypothetical fields the endpoint might add later.
      userId: "user_123",
      email: "secret@example.com",
      sessionToken: "ey.tok.en",
      refreshToken: "refresh-secret",
      cookies: { WorkosCursorSessionToken: "ey.tok.en" },
    };
    const out = sanitizeUsageBody(raw) as Record<string, unknown>;

    expect(Object.keys(out).sort()).toEqual([
      "billingCycleEnd",
      "billingCycleStart",
      "individualUsage",
      "isUnlimited",
      "limitType",
      "teamUsage",
    ]);
    expect(out.limitType).toBeNull();
    expect(out.isUnlimited).toBeNull();
    expect(out.individualUsage).toEqual({});
    expect(out.teamUsage).toEqual({});
    expect(JSON.stringify(out)).not.toContain("user_123");
    expect(JSON.stringify(out)).not.toContain("secret@example.com");
    expect(JSON.stringify(out)).not.toContain("ey.tok.en");
    expect(JSON.stringify(out)).not.toContain("refresh-secret");
  });

  it("drops unknown nested fields inside plan/onDemand", () => {
    const raw = {
      individualUsage: {
        plan: {
          autoPercentUsed: 1,
          internalUserId: "user_123",
          breakdown: { included: 1, total: 1, secret: "x" },
        },
        onDemand: { enabled: true, billingAccountId: "acct_xyz" },
        debugSnapshot: { sessionToken: "ey.tok.en" },
      },
    };
    const out = sanitizeUsageBody(raw) as {
      individualUsage: {
        plan: Record<string, unknown> & { breakdown: Record<string, unknown> };
        onDemand: Record<string, unknown>;
        debugSnapshot?: unknown;
      };
    };

    expect(out.individualUsage.plan.autoPercentUsed).toBe(1);
    expect("internalUserId" in out.individualUsage.plan).toBe(false);
    expect("secret" in out.individualUsage.plan.breakdown).toBe(false);
    expect("billingAccountId" in out.individualUsage.onDemand).toBe(false);
    expect(out.individualUsage.onDemand.enabled).toBe(true);
    expect("debugSnapshot" in out.individualUsage).toBe(false);
  });

  it("coerces unexpected types to null instead of leaking them", () => {
    const raw = {
      billingCycleStart: { nested: "not a string" },
      isUnlimited: "yes",
      individualUsage: {
        plan: { used: "lots", enabled: 1 },
      },
    };
    const out = sanitizeUsageBody(raw) as {
      billingCycleStart: unknown;
      isUnlimited: unknown;
      individualUsage: { plan: { used: unknown; enabled: unknown } };
    };

    expect(out.billingCycleStart).toBeNull();
    expect(out.isUnlimited).toBeNull();
    expect(out.individualUsage.plan.used).toBeNull();
    expect(out.individualUsage.plan.enabled).toBeNull();
  });

  it("returns null when the body itself is not a plain object", () => {
    expect(sanitizeUsageBody(null)).toBeNull();
    expect(sanitizeUsageBody("payload")).toBeNull();
    expect(sanitizeUsageBody([1, 2, 3])).toBeNull();
  });
});
