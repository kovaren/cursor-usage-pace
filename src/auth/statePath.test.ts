import { describe, expect, it } from "vitest";
import { getDefaultCursorStateDbPath, resolveStateDbPath } from "./statePath";

describe("getDefaultCursorStateDbPath", () => {
  it("returns macOS Application Support path", () => {
    const result = getDefaultCursorStateDbPath("darwin", "/Users/me", {});
    expect(result).toBe(
      "/Users/me/Library/Application Support/Cursor/User/globalStorage/state.vscdb",
    );
  });

  it("returns Windows %APPDATA% path", () => {
    const result = getDefaultCursorStateDbPath("win32", "C:\\Users\\me", {
      APPDATA: "C:\\Users\\me\\AppData\\Roaming",
    });
    expect(result.replace(/\\/g, "/")).toBe(
      "C:/Users/me/AppData/Roaming/Cursor/User/globalStorage/state.vscdb",
    );
  });

  it("falls back to ~/AppData/Roaming on Windows when APPDATA is unset", () => {
    const result = getDefaultCursorStateDbPath("win32", "C:\\Users\\me", {});
    expect(result.replace(/\\/g, "/")).toBe(
      "C:/Users/me/AppData/Roaming/Cursor/User/globalStorage/state.vscdb",
    );
  });

  it("returns Linux $XDG_CONFIG_HOME path when set", () => {
    const result = getDefaultCursorStateDbPath("linux", "/home/me", {
      XDG_CONFIG_HOME: "/home/me/.config",
    });
    expect(result).toBe(
      "/home/me/.config/Cursor/User/globalStorage/state.vscdb",
    );
  });

  it("returns Linux ~/.config path when XDG is unset", () => {
    const result = getDefaultCursorStateDbPath("linux", "/home/me", {});
    expect(result).toBe(
      "/home/me/.config/Cursor/User/globalStorage/state.vscdb",
    );
  });
});

describe("resolveStateDbPath", () => {
  it("returns the default when override is empty", () => {
    const def = getDefaultCursorStateDbPath();
    expect(resolveStateDbPath(undefined)).toBe(def);
    expect(resolveStateDbPath(null)).toBe(def);
    expect(resolveStateDbPath("")).toBe(def);
    expect(resolveStateDbPath("   ")).toBe(def);
  });

  it("expands a leading tilde", () => {
    const result = resolveStateDbPath("~/custom/state.vscdb");
    expect(result.endsWith("/custom/state.vscdb")).toBe(true);
    expect(result.startsWith("~")).toBe(false);
  });

  it("returns absolute paths unchanged", () => {
    expect(resolveStateDbPath("/tmp/state.vscdb")).toBe("/tmp/state.vscdb");
  });
});
