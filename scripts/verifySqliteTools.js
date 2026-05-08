#!/usr/bin/env node

const fs = require("fs");
const path = require("path");
const { SQLITE_TOOLS } = require("./sqliteToolsConfig");

const repoRoot = path.resolve(__dirname, "..");
const vendorRoot = path.join(repoRoot, "vendor", "sqlite");

let failed = false;

for (const tool of SQLITE_TOOLS) {
  const executablePath = path.join(
    vendorRoot,
    tool.target,
    tool.executableName,
  );

  if (!fs.existsSync(executablePath)) {
    console.error(`Missing ${path.relative(repoRoot, executablePath)}`);
    failed = true;
    continue;
  }

  const stat = fs.statSync(executablePath);
  if (!stat.isFile() || stat.size === 0) {
    console.error(`Invalid ${path.relative(repoRoot, executablePath)}`);
    failed = true;
    continue;
  }

  if (tool.executableName !== "sqlite3.exe" && (stat.mode & 0o111) === 0) {
    console.error(`Not executable: ${path.relative(repoRoot, executablePath)}`);
    failed = true;
  }
}

if (failed) {
  console.error("Run `npm run sqlite:download` to refresh bundled SQLite tools.");
  process.exit(1);
}

console.log(`Verified ${SQLITE_TOOLS.length} bundled SQLite tools.`);
