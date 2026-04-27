import * as os from "os";
import * as path from "path";

const STATE_DB_RELATIVE_PARTS = ["User", "globalStorage", "state.vscdb"];

/**
 * Returns the platform-specific path to Cursor's `state.vscdb` SQLite database.
 *
 * Cursor uses VS Code's standard user-data layout, but rooted at a "Cursor"
 * directory rather than "Code". The database is what Cursor itself reads and
 * writes for things like `cursorAuth/accessToken`.
 *
 * The returned path is not validated for existence; callers should handle
 * the missing-file case to support fresh installs and signed-out states.
 */
export function getDefaultCursorStateDbPath(
  platform: NodeJS.Platform = process.platform,
  homeDir: string = os.homedir(),
  env: NodeJS.ProcessEnv = process.env,
): string {
  const root = getCursorUserDataRoot(platform, homeDir, env);
  return path.join(root, ...STATE_DB_RELATIVE_PARTS);
}

function getCursorUserDataRoot(
  platform: NodeJS.Platform,
  homeDir: string,
  env: NodeJS.ProcessEnv,
): string {
  switch (platform) {
    case "darwin":
      return path.join(homeDir, "Library", "Application Support", "Cursor");
    case "win32": {
      const appData = env.APPDATA ?? path.join(homeDir, "AppData", "Roaming");
      return path.join(appData, "Cursor");
    }
    default: {
      const xdgConfig = env.XDG_CONFIG_HOME ?? path.join(homeDir, ".config");
      return path.join(xdgConfig, "Cursor");
    }
  }
}

/**
 * Resolves the state-db path the extension should use, honoring the user's
 * `cursorUsagePace.stateDbPath` override when set. Tilde and `$HOME` are
 * expanded so the override behaves like a shell path.
 */
export function resolveStateDbPath(override: string | undefined | null): string {
  if (!override || override.trim().length === 0) {
    return getDefaultCursorStateDbPath();
  }
  return expandHome(override.trim());
}

function expandHome(p: string): string {
  if (p.startsWith("~")) {
    return path.join(os.homedir(), p.slice(1));
  }
  return p;
}
