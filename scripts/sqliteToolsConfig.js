const SQLITE_TOOLS_VERSION = "3530100";
const SQLITE_TOOLS_YEAR = "2026";

const SQLITE_TOOLS = [
  {
    target: "win32-x64",
    archiveName: `sqlite-tools-win-x64-${SQLITE_TOOLS_VERSION}.zip`,
    executableName: "sqlite3.exe",
  },
  {
    target: "darwin-arm64",
    archiveName: `sqlite-tools-osx-arm64-${SQLITE_TOOLS_VERSION}.zip`,
    executableName: "sqlite3",
  },
  {
    target: "darwin-x64",
    archiveName: `sqlite-tools-osx-x64-${SQLITE_TOOLS_VERSION}.zip`,
    executableName: "sqlite3",
  },
  {
    target: "linux-x64",
    archiveName: `sqlite-tools-linux-x64-${SQLITE_TOOLS_VERSION}.zip`,
    executableName: "sqlite3",
  },
];

module.exports = {
  SQLITE_TOOLS,
  SQLITE_TOOLS_VERSION,
  SQLITE_TOOLS_YEAR,
};
