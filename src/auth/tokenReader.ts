import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";

const ACCESS_TOKEN_KEY = "cursorAuth/accessToken";
const SQLITE_CLI_ENV = "CURSOR_USAGE_PACE_SQLITE3";

export type TokenReadKind =
  | "dbMissing"
  | "dbUnreadable"
  | "tokenMissing"
  | "tokenEmpty";

export type ReadStrategy = "sqlite3-cli";

export type SqliteCliSource = "env" | "bundled" | "path";

export interface SqliteCliResolution {
  command: string;
  source: SqliteCliSource;
}

export interface ResolveSqliteCliOptions {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  arch?: NodeJS.Architecture;
  rootDir?: string;
  existsSync?: (p: string) => boolean;
}

export interface ReadAccessTokenResult {
  token: string;
  strategy: ReadStrategy;
}

export class TokenReadError extends Error {
  constructor(
    message: string,
    public readonly kind: TokenReadKind,
    options?: { cause?: unknown },
  ) {
    super(message, options as ErrorOptions);
    this.name = "TokenReadError";
  }
}

export interface ReadAccessTokenOptions {
  /**
   * Receives one human-readable line per attempt so the extension's
   * logs can show which strategy succeeded or how each failed.
   */
  log?: (message: string) => void;
}

/**
 * Reads `cursorAuth/accessToken` from Cursor's local SQLite database.
 *
 * Uses the sqlite3 CLI instead of a native Node module so a universal VSIX
 * does not depend on Electron/Node ABI-specific `.node` binaries.
 *
 * The whole thing is read-only so we never contend with Cursor's writer.
 */
export function readAccessToken(
  dbPath: string,
  opts: ReadAccessTokenOptions = {},
): string {
  return readAccessTokenWithStrategy(dbPath, opts).token;
}

export function readAccessTokenWithStrategy(
  dbPath: string,
  opts: ReadAccessTokenOptions = {},
): ReadAccessTokenResult {
  if (!fs.existsSync(dbPath)) {
    throw new TokenReadError(
      `Cursor state database not found at ${dbPath}`,
      "dbMissing",
    );
  }

  const log = opts.log ?? (() => undefined);
  const errors: { strategy: ReadStrategy; error: Error }[] = [];
  const sqliteCli = resolveSqliteCli();

  try {
    log(`Trying sqlite3 CLI (${sqliteCli.command})…`);
    const value = readViaSqliteCli(dbPath, sqliteCli.command);
    log(`sqlite3 CLI succeeded (${sqliteCli.source})`);
    return { token: finalizeValue(value), strategy: "sqlite3-cli" };
  } catch (err) {
    if (err instanceof TokenReadError) {
      throw err;
    }
    errors.push({ strategy: "sqlite3-cli", error: err as Error });
    log(`sqlite3 CLI failed: ${formatError(err)}`);
  }

  throw new TokenReadError(
    buildAggregateMessage(dbPath, errors),
    "dbUnreadable",
    { cause: errors[errors.length - 1]?.error },
  );
}

export function resolveSqliteCli(
  opts: ResolveSqliteCliOptions = {},
): SqliteCliResolution {
  const env = opts.env ?? process.env;
  const override = env[SQLITE_CLI_ENV]?.trim();
  if (override) {
    return { command: override, source: "env" };
  }

  const platform = opts.platform ?? process.platform;
  const arch = opts.arch ?? process.arch;
  const rootDir = opts.rootDir ?? path.resolve(__dirname, "..", "..");
  const existsSync = opts.existsSync ?? fs.existsSync;
  const bundled = getBundledSqliteCliPath(rootDir, platform, arch);
  if (bundled && existsSync(bundled)) {
    return { command: bundled, source: "bundled" };
  }

  return { command: "sqlite3", source: "path" };
}

function getBundledSqliteCliPath(
  rootDir: string,
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
): string | undefined {
  const target = getBundledSqliteTarget(platform, arch);
  if (!target) return undefined;

  const executable = platform === "win32" ? "sqlite3.exe" : "sqlite3";
  return path.join(rootDir, "vendor", "sqlite", target, executable);
}

function getBundledSqliteTarget(
  platform: NodeJS.Platform,
  arch: NodeJS.Architecture,
): string | undefined {
  switch (`${platform}-${arch}`) {
    case "win32-x64":
    case "darwin-arm64":
    case "darwin-x64":
    case "linux-x64":
      return `${platform}-${arch}`;
    default:
      return undefined;
  }
}

function readViaSqliteCli(dbPath: string, sqliteCli: string): string {
  // We pass the DB path and the SQL as separate argv entries so there's no
  // shell metacharacter risk. The query selects nothing else, so the only
  // thing that can come back is either an empty string or the value column.
  let stdout: string;
  try {
    stdout = execFileSync(
      sqliteCli,
      [
        "-readonly",
        "-bail",
        "-noheader",
        "-csv",
        dbPath,
        `SELECT value FROM ItemTable WHERE key='${ACCESS_TOKEN_KEY}';`,
      ],
      {
        encoding: "utf8",
        timeout: 10_000,
        stdio: ["ignore", "pipe", "pipe"],
        windowsHide: true,
      },
    );
  } catch (err) {
    const e = err as NodeJS.ErrnoException;
    if (e.code === "ENOENT") {
      throw enrich(
        err,
        `\`${sqliteCli}\` not found (set ${SQLITE_CLI_ENV} to override)`,
      );
    }
    throw enrich(err, "sqlite3 CLI exited with an error");
  }

  const trimmed = stdout.trim();
  if (trimmed.length === 0) {
    throw new TokenReadError(
      "Cursor access token not found. Sign in to Cursor and try again.",
      "tokenMissing",
    );
  }
  return unwrapCsvValue(trimmed);
}

function finalizeValue(raw: string): string {
  const token = parseStoredValue(raw);
  if (!token || token.length === 0) {
    throw new TokenReadError(
      "Cursor access token is empty. Sign in to Cursor and try again.",
      "tokenEmpty",
    );
  }
  return token;
}

/**
 * VS Code stores `ItemTable.value` as a TEXT column. Some keys hold raw
 * strings, others hold JSON-encoded strings (i.e. with surrounding quotes).
 * Normalize so callers always get the JWT itself.
 */
function parseStoredValue(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (typeof parsed === "string") {
        return parsed;
      }
    } catch {
      // fall through
    }
  }
  return trimmed;
}

/**
 * sqlite3 CLI in CSV mode wraps strings containing special characters in
 * double quotes and doubles internal quotes. Token values don't contain
 * commas/newlines so this is just a "strip outer quotes if any" pass.
 */
function unwrapCsvValue(line: string): string {
  if (line.startsWith('"') && line.endsWith('"') && line.length >= 2) {
    return line.slice(1, -1).replace(/""/g, '"');
  }
  return line;
}

function enrich(err: unknown, hint: string): Error {
  if (err instanceof Error) {
    err.message = `${hint}: ${err.message}`;
    return err;
  }
  return new Error(`${hint}: ${String(err)}`);
}

function formatError(err: unknown): string {
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code;
    return code ? `${err.message} [${code}]` : err.message;
  }
  return String(err);
}

function buildAggregateMessage(
  dbPath: string,
  errors: { strategy: ReadStrategy; error: Error }[],
): string {
  const lines = [
    `Could not open Cursor state database at ${dbPath}.`,
    ...errors.map(
      ({ strategy, error }) => `  • ${strategy}: ${formatError(error)}`,
    ),
  ];
  return lines.join("\n");
}
