#!/usr/bin/env node

const childProcess = require("child_process");
const fs = require("fs");
const https = require("https");
const os = require("os");
const path = require("path");
const {
  SQLITE_TOOLS,
  SQLITE_TOOLS_VERSION,
  SQLITE_TOOLS_YEAR,
} = require("./sqliteToolsConfig");

const repoRoot = path.resolve(__dirname, "..");
const vendorRoot = path.join(repoRoot, "vendor", "sqlite");
const downloadRoot = path.join(repoRoot, "TEMP", "sqlite-tools");

async function main() {
  fs.mkdirSync(downloadRoot, { recursive: true });

  for (const tool of SQLITE_TOOLS) {
    await installTool(tool);
  }

  console.log(
    `Downloaded SQLite tools ${formatSqliteVersion(SQLITE_TOOLS_VERSION)} to ${path.relative(
      repoRoot,
      vendorRoot,
    )}`,
  );
}

async function installTool(tool) {
  const url = `https://www.sqlite.org/${SQLITE_TOOLS_YEAR}/${tool.archiveName}`;
  const archivePath = path.join(downloadRoot, tool.archiveName);
  const extractDir = path.join(downloadRoot, tool.target);
  const targetDir = path.join(vendorRoot, tool.target);
  const targetPath = path.join(targetDir, tool.executableName);

  console.log(`Downloading ${url}`);
  await downloadFile(url, archivePath);

  fs.rmSync(extractDir, { recursive: true, force: true });
  fs.mkdirSync(extractDir, { recursive: true });
  extractZip(archivePath, extractDir);

  const executable = findFile(extractDir, tool.executableName);
  if (!executable) {
    throw new Error(`Could not find ${tool.executableName} in ${tool.archiveName}`);
  }

  fs.mkdirSync(targetDir, { recursive: true });
  fs.copyFileSync(executable, targetPath);
  if (tool.executableName !== "sqlite3.exe") {
    fs.chmodSync(targetPath, 0o755);
  }
  console.log(`Installed ${path.relative(repoRoot, targetPath)}`);
}

function downloadFile(url, destination) {
  return new Promise((resolve, reject) => {
    const request = https.get(url, (response) => {
      if (
        response.statusCode >= 300 &&
        response.statusCode < 400 &&
        response.headers.location
      ) {
        response.resume();
        downloadFile(new URL(response.headers.location, url).toString(), destination)
          .then(resolve)
          .catch(reject);
        return;
      }

      if (response.statusCode !== 200) {
        response.resume();
        reject(new Error(`HTTP ${response.statusCode} for ${url}`));
        return;
      }

      const file = fs.createWriteStream(destination);
      response.pipe(file);
      file.on("finish", () => {
        file.close(resolve);
      });
      file.on("error", reject);
    });

    request.on("error", reject);
  });
}

function extractZip(archivePath, destination) {
  if (process.platform === "win32") {
    childProcess.execFileSync(
      "powershell.exe",
      [
        "-NoProfile",
        "-Command",
        "Expand-Archive",
        "-LiteralPath",
        archivePath,
        "-DestinationPath",
        destination,
        "-Force",
      ],
      { stdio: "inherit", windowsHide: true },
    );
    return;
  }

  childProcess.execFileSync("unzip", ["-q", archivePath, "-d", destination], {
    stdio: "inherit",
  });
}

function findFile(dir, fileName) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(fullPath, fileName);
      if (found) return found;
    } else if (entry.isFile() && entry.name === fileName) {
      return fullPath;
    }
  }
  return undefined;
}

function formatSqliteVersion(versionCode) {
  const major = Number(versionCode.slice(0, 1));
  const minor = Number(versionCode.slice(1, 3));
  const patch = Number(versionCode.slice(3, 5));
  return `${major}.${minor}.${patch}`;
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
