import * as vscode from "vscode";
import { CONFIG_SECTION } from "./config";
import { PaceController } from "./controller";
import { Logger } from "./logger";
import { SummaryCache } from "./state/cache";
import { PaceStatusBar } from "./ui/statusBar";

const COMMAND_REFRESH = "cursorUsagePace.refresh";
const COMMAND_OPEN_DASHBOARD = "cursorUsagePace.openDashboard";
const COMMAND_SHOW_LOGS = "cursorUsagePace.showLogs";
const DASHBOARD_URL = "https://cursor.com/dashboard/spending";

export function activate(context: vscode.ExtensionContext): void {
  const version = (context.extension.packageJSON?.version as string) ?? "0.0.0";

  const logger = new Logger("Cursor Usage Pace");
  const statusBar = new PaceStatusBar(COMMAND_REFRESH);
  const cache = new SummaryCache(context.globalState);

  const controller = new PaceController(
    statusBar,
    cache,
    logger,
    {
      refresh: COMMAND_REFRESH,
      openDashboard: COMMAND_OPEN_DASHBOARD,
      showLogs: COMMAND_SHOW_LOGS,
    },
    version,
  );

  context.subscriptions.push(
    statusBar,
    logger,
    controller,
    vscode.commands.registerCommand(COMMAND_REFRESH, () =>
      controller.refresh({ showLoading: true }),
    ),
    vscode.commands.registerCommand(COMMAND_OPEN_DASHBOARD, () =>
      vscode.env.openExternal(vscode.Uri.parse(DASHBOARD_URL)),
    ),
    vscode.commands.registerCommand(COMMAND_SHOW_LOGS, () =>
      logger.show(),
    ),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(CONFIG_SECTION)) {
        controller.onConfigurationChanged();
      }
    }),
    vscode.window.onDidChangeWindowState((state) => {
      if (state.focused) controller.checkForAuthChange();
    }),
  );

  controller.start();
}

export function deactivate(): void {
  // Disposables are released via context.subscriptions.
}
