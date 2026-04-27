import { describe, expect, it } from "vitest";
import {
  JwtDecodeError,
  buildSessionCookieValue,
  decodeJwtPayload,
  isJwtExpired,
} from "./jwt";

function makeJwt(payload: Record<string, unknown>): string {
  const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const body = base64Url(JSON.stringify(payload));
  return `${header}.${body}.signaturestub`;
}

function base64Url(input: string): string {
  return Buffer.from(input, "utf8")
    .toString("base64")
    .replace(/=+$/, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");
}

describe("decodeJwtPayload", () => {
  it("decodes a standard JWT payload", () => {
    const jwt = makeJwt({ sub: "user_abc", iat: 1, exp: 2 });
    const payload = decodeJwtPayload(jwt);
    expect(payload.sub).toBe("user_abc");
    expect(payload.iat).toBe(1);
    expect(payload.exp).toBe(2);
  });

  it("throws JwtDecodeError on a non-JWT string", () => {
    expect(() => decodeJwtPayload("not-a-token")).toThrow(JwtDecodeError);
  });

  it("throws JwtDecodeError when the payload is not JSON", () => {
    const broken = `${base64Url("{}")}.${base64Url("not json")}.sig`;
    expect(() => decodeJwtPayload(broken)).toThrow(JwtDecodeError);
  });
});

describe("buildSessionCookieValue", () => {
  it("uses the raw sub when there is no issuer prefix", () => {
    const jwt = makeJwt({ sub: "user_abc" });
    expect(buildSessionCookieValue(jwt)).toBe(`user_abc::${jwt}`);
  });

  it("strips the issuer prefix from sub", () => {
    const jwt = makeJwt({ sub: "auth0|user_xyz" });
    expect(buildSessionCookieValue(jwt)).toBe(`user_xyz::${jwt}`);
  });

  it("throws when sub is missing", () => {
    const jwt = makeJwt({ iat: 1 });
    expect(() => buildSessionCookieValue(jwt)).toThrow(JwtDecodeError);
  });
});

describe("isJwtExpired", () => {
  it("returns false when exp is in the future", () => {
    const jwt = makeJwt({ sub: "user_abc", exp: 9_999_999_999 });
    expect(isJwtExpired(jwt, 1_000_000_000_000)).toBe(false);
  });

  it("returns true when exp is well in the past", () => {
    const jwt = makeJwt({ sub: "user_abc", exp: 1 });
    expect(isJwtExpired(jwt, Date.now())).toBe(true);
  });

  it("returns false when exp is missing", () => {
    const jwt = makeJwt({ sub: "user_abc" });
    expect(isJwtExpired(jwt)).toBe(false);
  });

  it("returns false when the token cannot be decoded", () => {
    expect(isJwtExpired("garbage")).toBe(false);
  });
});
