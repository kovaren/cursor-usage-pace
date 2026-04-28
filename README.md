# Cursor Usage Pace

A small Cursor / VS Code extension that shows in the status bar whether you are ahead or behind on your monthly Cursor quota, given how far through the billing cycle you are.

Cursor's own dashboard shows you *what* you have used (e.g. "Auto + Composer 12%, API 38%"). It does not tell you whether that is a lot or a little for the date. This extension does that math for you.

## Status bar

Each configured track is shown inline with a directional arrow and the absolute delta:

```
Auto ↑18% • API ↑12%        ← both burning faster than pace
Auto ↓2%  • API ↓1%         ← both comfortably under pace
Auto ↓27% • API ↓39%        ← heavily under-using
```

## Detailed view

Hover the status bar item for a full breakdown:

```
Cursor Usage Pace

Cycle: Apr 4 → May 4 · 77% elapsed · 8 days left

| Track            | Used | Pace              |
| Auto + Composer  | 12%  | underused by 65%  |
| API              | 38%  | underused by 39%  |

Last refreshed 2 min ago · Refresh · Dashboard · Diagnostics
```

Pace values are colored: **green** = under pace (capacity to spare), **orange** = over pace (burning faster than expected).

Clicking the bar or "Refresh" in the tooltip triggers a manual refresh.

## Pace math

```
elapsed   = clamp(now - cycleStart, 0, cycleLen)
expected% = elapsed / cycleLen * 100
pace     = actual% - expected%      // negative = under-using, positive = over-using
```

## Settings

| Setting | Default | What it does |
| ------- | ------- | ------------ |
| `cursorUsagePace.refreshIntervalMinutes` | `10` | How often to refresh. Min 1, max 360. |
| `cursorUsagePace.onPaceThresholdPp` | `3` | A track is "on pace" when its delta is within `±N` percentage points. |
| `cursorUsagePace.show` | `auto+api` | What to render: `auto+api`, `auto`, `api`, or `total`. |
| `cursorUsagePace.stateDbPath` | `""` | Override the auto-detected SQLite path. Tilde expansion supported. |

## Commands

- **Cursor Usage Pace: Refresh now** — manual refresh (also bound to clicking the status bar item).
- **Cursor Usage Pace: Open Cursor dashboard** — opens `cursor.com/dashboard` in your browser.
- **Cursor Usage Pace: Show diagnostics** — opens the output channel with the last response summary, last error, and timing info.

## Privacy & safety

- **No telemetry.** No third-party hosts. The only network destination is `cursor.com`.
- **No credential UI.** The extension does not ask you for your password or session cookie, only reads what Cursor itself wrote to your local disk.
- **Tokens and cookies stay off the logs.** The diagnostics channel avoids printing access tokens, JWT material, or `WorkosCursorSessionToken` values.
- **Cache.** The last successful usage summary is stored in `context.globalState` (Cursor's normal extension-storage area) so the bar can still show a value when offline. Only the normalized fields shown above are cached — the raw API response is not.
- **No write access to the Cursor database.** The DB is opened read-only; we don't fight Cursor's writer.


## Caveats

- `cursor.com/api/usage-summary` is **not a documented public API**. If Cursor changes the schema or the endpoint, this extension will surface a "couldn't refresh" status until it's updated. The parser is deliberately permissive (multiple field-name variants, percentage normalization) but it can't cover every future change.
- Cursor exposes **no first-party extension API for usage data** as of this writing — the documented `vscode.cursor` namespace covers MCP and plugin registration only. Reading the local SQLite is the same approach used by other community extensions (e.g. `numanaral/cursor-usage-stats`, `Dwtexe/cursor-stats`, `lixwen/cursor-usage-monitor`).
- The native `better-sqlite3` module ships prebuilt binaries that are compatible with the Electron version Cursor uses. If you ever see "could not open Cursor state database" with a native-module error, run `npm rebuild better-sqlite3` against the Electron version of your editor.

## Troubleshooting

- **Status bar shows "Cursor: sign in"** — sign in to Cursor and click the bar to refresh.
- **Status bar shows "Cursor Usage Pace" in warning color** — open *Cursor Usage Pace: Show diagnostics* to see the last error. Common causes: temporary 5xx, network down, schema drift on `usage-summary`.
- **Numbers look wrong** — compare to [cursor.com/dashboard](https://cursor.com/dashboard). The dashboard is the source of truth; this extension only reframes it.
- **Diagnostics show "better-sqlite3 failed: …"** — The `better-sqlite3` native module ships prebuilt binaries for Node.js, but Cursor runs Electron, so the prebuilt binary doesn't always match the host ABI. The extension falls back automatically to the system `sqlite3` CLI for that reason, and your status bar should still update via that path. macOS and most Linux distros include `sqlite3` by default; on Windows, [install it](https://www.sqlite.org/download.html) and ensure it's in `PATH`. You can override the binary path via the `CURSOR_USAGE_PACE_SQLITE3` environment variable.

## License

MIT.
