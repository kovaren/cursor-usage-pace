/**
 * Returns a redacted form of a token / cookie / other secret value safe to
 * log: `abcd…wxyz (len=N)` for inputs longer than 8 characters, or
 * `(redacted, len=N)` for shorter ones. Empty inputs become `(empty)`.
 *
 * This is the only function in the codebase that should ever decide what
 * a secret looks like in human-visible output.
 */
export function mask(secret: string | undefined | null): string {
  if (!secret) return "(empty)";
  const clean = secret.trim();
  if (clean.length === 0) return "(empty)";
  if (clean.length <= 8) return `(redacted, len=${clean.length})`;
  return `${clean.slice(0, 4)}…${clean.slice(-4)} (len=${clean.length})`;
}
