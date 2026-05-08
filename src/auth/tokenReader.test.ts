import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  TokenReadError,
  readAccessToken,
  readAccessTokenWithStrategy,
  resolveSqliteCli,
} from "./tokenReader";

let tmpDir: string;
let dbPath: string;

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "cup-test-"));
  dbPath = path.join(tmpDir, "state.vscdb");
});

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
});

function getTestSqliteCli(): string | undefined {
  const command = resolveSqliteCli().command;
  try {
    execFileSync(command, ["-version"], { stdio: "ignore", timeout: 5000 });
    return command;
  } catch {
    return undefined;
  }
}

function createDb(rows: Array<[string, string]> = []): void {
  const sqliteCli = getTestSqliteCli();
  if (!sqliteCli) {
    throw new Error("sqlite3 CLI is required for this test");
  }

  const statements = ["CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value BLOB);"];
  for (const [key, value] of rows) {
    statements.push(
      `INSERT INTO ItemTable (key, value) VALUES (${sqlString(key)}, ${sqlString(value)});`,
    );
  }
  execFileSync(sqliteCli, [dbPath], {
    input: statements.join("\n"),
    encoding: "utf8",
    stdio: ["pipe", "pipe", "pipe"],
    timeout: 5000,
  });
}

function hasSqlite3Cli(): boolean {
  return getTestSqliteCli() !== undefined;
}

function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

describe("resolveSqliteCli", () => {
  it("uses CURSOR_USAGE_PACE_SQLITE3 before any bundled binary", () => {
    const result = resolveSqliteCli({
      env: { CURSOR_USAGE_PACE_SQLITE3: "/custom/sqlite3" },
      platform: "win32",
      arch: "x64",
      rootDir: "/extension",
      existsSync: () => true,
    });

    expect(result).toEqual({ command: "/custom/sqlite3", source: "env" });
  });

  it.each([
    ["win32", "x64", "sqlite3.exe"],
    ["darwin", "arm64", "sqlite3"],
    ["darwin", "x64", "sqlite3"],
    ["linux", "x64", "sqlite3"],
  ] as const)(
    "uses the bundled binary for %s-%s when present",
    (platform, arch, executable) => {
      const rootDir = path.join(tmpDir, "extension");
      const expected = path.join(
        rootDir,
        "vendor",
        "sqlite",
        `${platform}-${arch}`,
        executable,
      );
      const result = resolveSqliteCli({
        env: {},
        platform,
        arch,
        rootDir,
        existsSync: (p) => p === expected,
      });

      expect(result).toEqual({ command: expected, source: "bundled" });
    },
  );

  it("falls back to sqlite3 from PATH when no bundled binary applies", () => {
    const result = resolveSqliteCli({
      env: {},
      platform: "freebsd",
      arch: "x64",
      rootDir: "/extension",
      existsSync: () => false,
    });

    expect(result).toEqual({ command: "sqlite3", source: "path" });
  });

  it("falls back to sqlite3 from PATH when the bundled binary is absent", () => {
    const result = resolveSqliteCli({
      env: {},
      platform: "win32",
      arch: "x64",
      rootDir: "/extension",
      existsSync: () => false,
    });

    expect(result).toEqual({ command: "sqlite3", source: "path" });
  });
});

describe("readAccessToken (sqlite3 CLI path)", () => {
  const cliAvailable = hasSqlite3Cli();
  const itIfCli = cliAvailable ? it : it.skip;

  it("throws dbMissing when the file does not exist", () => {
    try {
      readAccessToken(path.join(tmpDir, "missing.vscdb"));
      expect.fail("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(TokenReadError);
      expect((err as TokenReadError).kind).toBe("dbMissing");
    }
  });

  itIfCli("throws tokenMissing when the row is absent", () => {
    createDb([["someOtherKey", "value"]]);
    try {
      readAccessToken(dbPath);
      expect.fail("expected to throw");
    } catch (err) {
      expect((err as TokenReadError).kind).toBe("tokenMissing");
    }
  });

  itIfCli("throws tokenEmpty when the value is an empty string", () => {
    createDb([["cursorAuth/accessToken", ""]]);
    try {
      readAccessToken(dbPath);
      expect.fail("expected to throw");
    } catch (err) {
      expect((err as TokenReadError).kind).toBe("tokenEmpty");
    }
  });

  itIfCli("returns the raw token when stored as plain text", () => {
    createDb([["cursorAuth/accessToken", "raw.jwt.value"]]);
    expect(readAccessToken(dbPath)).toBe("raw.jwt.value");
  });

  itIfCli("unwraps a JSON-encoded string value", () => {
    createDb([["cursorAuth/accessToken", '"quoted.jwt.value"']]);
    expect(readAccessToken(dbPath)).toBe("quoted.jwt.value");
  });

  itIfCli("trims surrounding whitespace", () => {
    createDb([["cursorAuth/accessToken", "  spaced.jwt.value  "]]);
    expect(readAccessToken(dbPath)).toBe("spaced.jwt.value");
  });

  itIfCli("reports sqlite3-cli as the successful strategy when it works", () => {
    createDb([["cursorAuth/accessToken", "raw.jwt.value"]]);
    const result = readAccessTokenWithStrategy(dbPath);
    expect(result.token).toBe("raw.jwt.value");
    expect(result.strategy).toBe("sqlite3-cli");
  });

  itIfCli("logs the CLI attempt via the log callback", () => {
    createDb([["cursorAuth/accessToken", "raw.jwt.value"]]);
    const lines: string[] = [];
    readAccessTokenWithStrategy(dbPath, { log: (m) => lines.push(m) });
    expect(lines.some((line) => line.startsWith("Trying sqlite3 CLI"))).toBe(true);
    expect(lines.some((line) => line.startsWith("sqlite3 CLI succeeded"))).toBe(true);
  });

  itIfCli("uses the CLI successfully when given a real DB", () => {
    createDb([["cursorAuth/accessToken", "cli.jwt.value"]]);
    const stdout = execFileSync(
      getTestSqliteCli() ?? "sqlite3",
      [
        "-readonly",
        "-bail",
        "-noheader",
        "-csv",
        dbPath,
        "SELECT value FROM ItemTable WHERE key='cursorAuth/accessToken';",
      ],
      { encoding: "utf8" },
    );
    expect(stdout.trim()).toBe("cli.jwt.value");
  });

  itIfCli("CLI path unwraps a CSV-quoted value", () => {
    createDb([["cursorAuth/accessToken", 'value"with"quotes']]);
    const stdout = execFileSync(
      getTestSqliteCli() ?? "sqlite3",
      [
        "-readonly",
        "-bail",
        "-noheader",
        "-csv",
        dbPath,
        "SELECT value FROM ItemTable WHERE key='cursorAuth/accessToken';",
      ],
      { encoding: "utf8" },
    );
    // CSV mode wraps strings containing quotes in double-quotes and doubles
    // internal ones. The unwrapCsvValue helper covers this — the test
    // confirms our assumption about the CLI's output format.
    expect(stdout.trim()).toBe('"value""with""quotes"');
  });
});

describe("readAccessToken (aggregate failures)", () => {
  const cliAvailable = hasSqlite3Cli();
  const itIfCli = cliAvailable ? it : it.skip;

  itIfCli("aggregates CLI errors into the dbUnreadable message", () => {
    fs.writeFileSync(dbPath, "this is not a sqlite database at all");
    try {
      readAccessTokenWithStrategy(dbPath);
      expect.fail("expected to throw");
    } catch (err) {
      expect((err as TokenReadError).kind).toBe("dbUnreadable");
      const msg = (err as Error).message;
      expect(msg).toContain("sqlite3-cli");
    }
  });
});
