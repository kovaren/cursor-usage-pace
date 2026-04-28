import * as vscode from "vscode";

/**
 * Single output-channel logger. Never logs access tokens, session cookies, or
 * other credential material. Generic errors and API summaries may appear as plain text.
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
