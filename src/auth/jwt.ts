export class JwtDecodeError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "JwtDecodeError";
  }
}

export interface JwtPayload {
  sub?: string;
  exp?: number;
  iat?: number;
  [claim: string]: unknown;
}

/**
 * Decodes a JWT payload without verifying the signature. We only need the
 * `sub` claim to assemble the `WorkosCursorSessionToken` cookie value, the
 * server is the one that actually validates the signed token.
 */
export function decodeJwtPayload(jwt: string): JwtPayload {
  const parts = jwt.split(".");
  if (parts.length < 2) {
    throw new JwtDecodeError("Token does not look like a JWT");
  }

  const payloadSegment = parts[1];
  const json = base64UrlDecode(payloadSegment);
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch (err) {
    throw new JwtDecodeError(
      `JWT payload is not valid JSON: ${(err as Error).message}`,
    );
  }

  if (typeof parsed !== "object" || parsed === null) {
    throw new JwtDecodeError("JWT payload is not an object");
  }
  return parsed as JwtPayload;
}

/**
 * Builds the cookie value Cursor's web dashboard sends for the
 * `WorkosCursorSessionToken` cookie: `<userId>::<jwt>`.
 *
 * The `userId` comes from the `sub` claim. Some Cursor JWTs prefix it with
 * an issuer slug like `auth0|user_xxx`; in that case Cursor uses the part
 * after the pipe as the user id.
 */
export function buildSessionCookieValue(jwt: string): string {
  const payload = decodeJwtPayload(jwt);
  const sub = payload.sub;
  if (typeof sub !== "string" || sub.length === 0) {
    throw new JwtDecodeError("JWT is missing a `sub` claim");
  }
  const userId = extractUserId(sub);
  return `${userId}::${jwt}`;
}

/**
 * Returns true if the JWT's `exp` claim is in the past (with a small skew
 * buffer). Used purely for diagnostics; the server is still the source of
 * truth for validity.
 */
export function isJwtExpired(jwt: string, nowMs: number = Date.now()): boolean {
  try {
    const payload = decodeJwtPayload(jwt);
    if (typeof payload.exp !== "number") {
      return false;
    }
    const expiryMs = payload.exp * 1000;
    return expiryMs <= nowMs - 60_000;
  } catch {
    return false;
  }
}

function extractUserId(sub: string): string {
  const pipeIdx = sub.indexOf("|");
  return pipeIdx === -1 ? sub : sub.slice(pipeIdx + 1);
}

function base64UrlDecode(segment: string): string {
  const padded = segment
    .replace(/-/g, "+")
    .replace(/_/g, "/")
    .padEnd(segment.length + ((4 - (segment.length % 4)) % 4), "=");
  return Buffer.from(padded, "base64").toString("utf8");
}
