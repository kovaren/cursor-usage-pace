import * as vscode from "vscode";
import { mask } from "./util/redact";

export { mask };

/**
 * Single output-channel logger. Token values, cookies, and any other
 * Cursor-issued credential MUST be passed through `mask()` before being
 * appended — never raw — so a `Diagnostics: Show` from a user's machine
 * cannot accidentally leak their session.
 */
export class Diagnostics {
  private readonly channel: vscode.OutputChannel;
  private lastError: string | undefined;
  private lastResponseSummary: string | undefined;

  constructor(name: string) {
    this.channel = vscode.window.createOutputChannel(name);
  }

  log(message: string): void {
    this.channel.appendLine(`[${timestamp()}] ${message}`);
  }

  recordError(message: string, cause?: unknown): void {
    const causeText = formatCause(cause);
    const fullMessage = causeText ? `${message}\n  ↳ ${causeText}` : message;
    this.lastError = `[${timestamp()}] ${fullMessage}`;
    this.log(`ERROR: ${fullMessage}`);
  }

  recordResponseSummary(summary: string): void {
    this.lastResponseSummary = `[${timestamp()}] ${summary}`;
    this.log(`OK: ${summary}`);
  }

  show(): void {
    this.channel.appendLine("");
    this.channel.appendLine("--- Diagnostics snapshot ---");
    this.channel.appendLine(`Last response: ${this.lastResponseSummary ?? "(none)"}`);
    this.channel.appendLine(`Last error:    ${this.lastError ?? "(none)"}`);
    this.channel.appendLine("----------------------------");
    this.channel.show(true);
  }

  dispose(): void {
    this.channel.dispose();
  }
}

function timestamp(): string {
  return new Date().toISOString();
}

function formatCause(cause: unknown): string | undefined {
  if (cause === undefined || cause === null) return undefined;
  if (cause instanceof Error) {
    const code = (cause as NodeJS.ErrnoException).code;
    const codeText = code ? ` [${code}]` : "";
    return `${cause.name}${codeText}: ${cause.message}`;
  }
  return String(cause);
}
