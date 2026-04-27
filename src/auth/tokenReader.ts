import * as fs from "fs";
import { execFileSync } from "child_process";

const ACCESS_TOKEN_KEY = "cursorAuth/accessToken";
const SQLITE_CLI = process.env.CURSOR_USAGE_PACE_SQLITE3 ?? "sqlite3";

export type TokenReadKind =
  | "dbMissing"
  | "dbUnreadable"
  | "tokenMissing"
  | "tokenEmpty";

export type ReadStrategy = "better-sqlite3" | "sqlite3-cli";

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
   * diagnostics can show which strategy succeeded or how each failed.
   */
  log?: (message: string) => void;
}

/**
 * Reads `cursorAuth/accessToken` from Cursor's local SQLite database.
 *
 * Tries two strategies in order:
 *   1. `better-sqlite3` (native module). Fast, but its prebuilt binaries
 *      are compiled for Node.js, not for whatever Electron version Cursor
 *      ships — so it sometimes fails to load (or to open the DB) inside
 *      the extension host.
 *   2. The system `sqlite3` CLI. Avoids native modules entirely and
 *      handles WAL/SHM concurrency the same way Cursor does.
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

  try {
    log("Trying better-sqlite3 reader…");
    const value = readViaBetterSqlite3(dbPath);
    log("better-sqlite3 reader succeeded");
    return { token: finalizeValue(value), strategy: "better-sqlite3" };
  } catch (err) {
    if (err instanceof TokenReadError) {
      throw err;
    }
    errors.push({ strategy: "better-sqlite3", error: err as Error });
    log(`better-sqlite3 failed: ${formatError(err)}`);
  }

  try {
    log(`Trying sqlite3 CLI fallback (${SQLITE_CLI})…`);
    const value = readViaSqliteCli(dbPath);
    log("sqlite3 CLI fallback succeeded");
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

function readViaBetterSqlite3(dbPath: string): string {
  // Imported lazily so a require-time failure surfaces here as a normal
  // Error rather than killing the whole module. (We see "no NODE_MODULE_VERSION"
  // style failures inside Electron when the prebuilt binary doesn't match.)
  let Database: typeof import("better-sqlite3");
  try {
    Database = require("better-sqlite3");
  } catch (err) {
    throw enrich(err, "could not load better-sqlite3 native module");
  }

  let db: import("better-sqlite3").Database;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch (err) {
    throw enrich(err, "Database constructor rejected the file");
  }

  try {
    const row = db
      .prepare("SELECT value FROM ItemTable WHERE key = ?")
      .get(ACCESS_TOKEN_KEY) as { value?: string } | undefined;
    if (!row || row.value === undefined || row.value === null) {
      throw new TokenReadError(
        "Cursor access token not found. Sign in to Cursor and try again.",
        "tokenMissing",
      );
    }
    return row.value;
  } finally {
    try {
      db.close();
    } catch {
      // ignore close errors
    }
  }
}

function readViaSqliteCli(dbPath: string): string {
  // We pass the DB path and the SQL as separate argv entries so there's no
  // shell metacharacter risk. The query selects nothing else, so the only
  // thing that can come back is either an empty string or the value column.
  let stdout: string;
  try {
    stdout = execFileSync(
      SQLITE_CLI,
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
        `\`${SQLITE_CLI}\` not found in PATH (set CURSOR_USAGE_PACE_SQLITE3 to override)`,
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
