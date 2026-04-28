#!/usr/bin/env node
/**
 * Offline smoke check: exercises the real token-discovery and cookie-build
 * pipeline against the user's actual Cursor SQLite database, without making
 * any network calls and without printing token or cookie values. Run after
 * `npm run compile`:
 *   node scripts/smokeOffline.js
 *   node scripts/smokeOffline.js /custom/path/to/state.vscdb
 */
"use strict";

const { existsSync, statSync } = require("fs");
const path = require("path");

const outDir = path.join(__dirname, "..", "out");
const { buildSessionCookieValue, isJwtExpired } = require(
  path.join(outDir, "auth", "jwt"),
);
const {
  getDefaultCursorStateDbPath,
  resolveStateDbPath,
} = require(path.join(outDir, "auth", "statePath"));
const { TokenReadError, readAccessTokenWithStrategy } = require(
  path.join(outDir, "auth", "tokenReader"),
);

function main() {
  const overridePath = process.argv[2];
  const dbPath = resolveStateDbPath(overridePath);
  const defaultPath = getDefaultCursorStateDbPath();

  console.log("Cursor Usage Pace — offline smoke check");
  console.log("---------------------------------------");
  console.log(`Default state-db path: ${defaultPath}`);
  console.log(`Resolved path:         ${dbPath}`);

  if (!existsSync(dbPath)) {
    console.log("Result: state.vscdb does NOT exist at that path.");
    return 2;
  }
  const stat = statSync(dbPath);
  console.log(`File size: ${stat.size} bytes`);

  let token, strategy;
  try {
    const result = readAccessTokenWithStrategy(dbPath, {
      log: (msg) => console.log(`  ${msg}`),
    });
    token = result.token;
    strategy = result.strategy;
  } catch (err) {
    if (err instanceof TokenReadError) {
      console.log(`Token read failed: ${err.kind} — ${err.message}`);
      return 3;
    }
    throw err;
  }
  console.log(`Token discovered via ${strategy} (token not printed)`);
  console.log(`Token expired (per JWT exp): ${isJwtExpired(token)}`);

  try {
    buildSessionCookieValue(token);
  } catch (err) {
    console.log(`Cookie build failed: ${err.message}`);
    return 4;
  }
  console.log("OK — token discovery and cookie construction succeeded.");
  console.log("");
  console.log("Next steps:");
  console.log("  • Press F5 in Cursor with this folder open to run the");
  console.log("    Extension Development Host and see the live status bar.");
  console.log("  • Or build a vsix: `npm install -g @vscode/vsce && vsce package`.");
  return 0;
}

process.exit(main());
