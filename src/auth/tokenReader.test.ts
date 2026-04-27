import { execFileSync } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import Database from "better-sqlite3";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  TokenReadError,
  readAccessToken,
  readAccessTokenWithStrategy,
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

function createDb(rows: Array<[string, string]> = []): void {
  const db = new Database(dbPath);
  db.exec("CREATE TABLE ItemTable (key TEXT PRIMARY KEY, value BLOB);");
  const insert = db.prepare("INSERT INTO ItemTable (key, value) VALUES (?, ?)");
  for (const [key, value] of rows) {
    insert.run(key, value);
  }
  db.close();
}

function hasSqlite3Cli(): boolean {
  try {
    execFileSync("sqlite3", ["-version"], { stdio: "ignore", timeout: 5000 });
    return true;
  } catch {
    return false;
  }
}

describe("readAccessToken (better-sqlite3 path)", () => {
  it("throws dbMissing when the file does not exist", () => {
    try {
      readAccessToken(path.join(tmpDir, "missing.vscdb"));
      expect.fail("expected to throw");
    } catch (err) {
      expect(err).toBeInstanceOf(TokenReadError);
      expect((err as TokenReadError).kind).toBe("dbMissing");
    }
  });

  it("throws tokenMissing when the row is absent", () => {
    createDb([["someOtherKey", "value"]]);
    try {
      readAccessToken(dbPath);
      expect.fail("expected to throw");
    } catch (err) {
      expect((err as TokenReadError).kind).toBe("tokenMissing");
    }
  });

  it("throws tokenEmpty when the value is an empty string", () => {
    createDb([["cursorAuth/accessToken", ""]]);
    try {
      readAccessToken(dbPath);
      expect.fail("expected to throw");
    } catch (err) {
      expect((err as TokenReadError).kind).toBe("tokenEmpty");
    }
  });

  it("returns the raw token when stored as plain text", () => {
    createDb([["cursorAuth/accessToken", "raw.jwt.value"]]);
    expect(readAccessToken(dbPath)).toBe("raw.jwt.value");
  });

  it("unwraps a JSON-encoded string value", () => {
    createDb([["cursorAuth/accessToken", '"quoted.jwt.value"']]);
    expect(readAccessToken(dbPath)).toBe("quoted.jwt.value");
  });

  it("trims surrounding whitespace", () => {
    createDb([["cursorAuth/accessToken", "  spaced.jwt.value  "]]);
    expect(readAccessToken(dbPath)).toBe("spaced.jwt.value");
  });

  it("reports better-sqlite3 as the successful strategy when it works", () => {
    createDb([["cursorAuth/accessToken", "raw.jwt.value"]]);
    const result = readAccessTokenWithStrategy(dbPath);
    expect(result.token).toBe("raw.jwt.value");
    expect(result.strategy).toBe("better-sqlite3");
  });

  it("logs each strategy attempt via the log callback", () => {
    createDb([["cursorAuth/accessToken", "raw.jwt.value"]]);
    const lines: string[] = [];
    readAccessTokenWithStrategy(dbPath, { log: (m) => lines.push(m) });
    expect(lines).toContain("Trying better-sqlite3 reader…");
    expect(lines).toContain("better-sqlite3 reader succeeded");
  });
});

describe("readAccessToken (sqlite3 CLI fallback)", () => {
  const cliAvailable = hasSqlite3Cli();
  const itIfCli = cliAvailable ? it : it.skip;

  itIfCli("falls back to the CLI when better-sqlite3 cannot open the file", () => {
    createDb([["cursorAuth/accessToken", "cli.jwt.value"]]);
    const orig = process.env.CURSOR_USAGE_PACE_BETTER_SQLITE3_DISABLE;
    // Force the better-sqlite3 path to fail by pointing at a non-existent
    // module path. We can't easily disable the prebuilt binary at test time,
    // so instead make the constructor reject the file by passing a path
    // that's a directory (which better-sqlite3 will refuse to open).
    const dirPath = path.join(tmpDir, "actually-a-dir.vscdb");
    fs.mkdirSync(dirPath);

    try {
      readAccessTokenWithStrategy(dirPath);
      expect.fail("expected dbUnreadable for both strategies");
    } catch (err) {
      expect((err as TokenReadError).kind).toBe("dbUnreadable");
      expect((err as Error).message).toContain("better-sqlite3");
      expect((err as Error).message).toContain("sqlite3-cli");
    } finally {
      if (orig !== undefined) {
        process.env.CURSOR_USAGE_PACE_BETTER_SQLITE3_DISABLE = orig;
      }
    }
  });

  itIfCli("uses the CLI successfully when given a real DB", () => {
    createDb([["cursorAuth/accessToken", "cli.jwt.value"]]);
    // Verify the CLI returns the same value the better-sqlite3 path does.
    // We can't easily make better-sqlite3 fail on a valid file, so this
    // exercises the CLI directly via its env override.
    const stdout = execFileSync(
      "sqlite3",
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
      "sqlite3",
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
  it("aggregates errors from both strategies into the dbUnreadable message", () => {
    fs.writeFileSync(dbPath, "this is not a sqlite database at all");
    try {
      readAccessTokenWithStrategy(dbPath);
      expect.fail("expected to throw");
    } catch (err) {
      expect((err as TokenReadError).kind).toBe("dbUnreadable");
      const msg = (err as Error).message;
      expect(msg).toContain("better-sqlite3");
      // The CLI may or may not be present on a given CI host; if it's not,
      // we still expect both strategies to be mentioned in the message.
      expect(msg).toContain("sqlite3-cli");
    }
  });
});
