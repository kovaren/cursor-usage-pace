import * as vscode from "vscode";
import { CONFIG_SECTION } from "./config";
import { PaceController } from "./controller";
import { Diagnostics } from "./diagnostics";
import { SummaryCache } from "./state/cache";
import { PaceStatusBar } from "./ui/statusBar";

const COMMAND_REFRESH = "cursorUsagePace.refresh";
const COMMAND_OPEN_DASHBOARD = "cursorUsagePace.openDashboard";
const COMMAND_SHOW_DIAGNOSTICS = "cursorUsagePace.showDiagnostics";
const DASHBOARD_URL = "https://cursor.com/dashboard/spending";

export function activate(context: vscode.ExtensionContext): void {
  const version = (context.extension.packageJSON?.version as string) ?? "0.0.0";

  const diagnostics = new Diagnostics("Cursor Usage Pace");
  const statusBar = new PaceStatusBar(COMMAND_REFRESH);
  const cache = new SummaryCache(context.globalState);

  const controller = new PaceController(
    statusBar,
    cache,
    diagnostics,
    {
      refresh: COMMAND_REFRESH,
      openDashboard: COMMAND_OPEN_DASHBOARD,
      showDiagnostics: COMMAND_SHOW_DIAGNOSTICS,
    },
    version,
  );

  context.subscriptions.push(
    statusBar,
    diagnostics,
    controller,
    vscode.commands.registerCommand(COMMAND_REFRESH, () =>
      controller.refresh({ showLoading: true }),
    ),
    vscode.commands.registerCommand(COMMAND_OPEN_DASHBOARD, () =>
      vscode.env.openExternal(vscode.Uri.parse(DASHBOARD_URL)),
    ),
    vscode.commands.registerCommand(COMMAND_SHOW_DIAGNOSTICS, () =>
      diagnostics.show(),
    ),
    vscode.workspace.onDidChangeConfiguration((e) => {
      if (e.affectsConfiguration(CONFIG_SECTION)) {
        controller.onConfigurationChanged();
      }
    }),
  );

  controller.start();
}

export function deactivate(): void {
  // Disposables are released via context.subscriptions.
}
