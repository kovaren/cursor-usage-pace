/**
 * Minimal stand-in for the `vscode` module so unit tests can import code
 * that touches `vscode.window`, `vscode.workspace`, `vscode.MarkdownString`
 * etc. without running inside an Extension Development Host.
 *
 * Aliased into tests via `vitest.config.ts` -> `resolve.alias.vscode`.
 */

export const StatusBarAlignment = {
  Left: 1,
  Right: 2,
} as const;

export class ThemeColor {
  constructor(public readonly id: string) {}
}

export class MarkdownString {
  value: string;
  isTrusted = false;
  supportThemeIcons = false;
  supportHtml = false;

  constructor(value?: string, supportThemeIcons?: boolean) {
    this.value = value ?? "";
    if (supportThemeIcons) this.supportThemeIcons = true;
  }

  appendMarkdown(text: string): this {
    this.value += text;
    return this;
  }

  appendCodeblock(text: string, _lang?: string): this {
    this.value += `\n\`\`\`\n${text}\n\`\`\`\n`;
    return this;
  }
}

class FakeStatusBarItem {
  text = "";
  tooltip: unknown = "";
  command: string | undefined;
  name = "";
  backgroundColor: unknown;

  show(): void {
    // intentionally empty
  }
  hide(): void {
    // intentionally empty
  }
  dispose(): void {
    // intentionally empty
  }
}

class FakeOutputChannel {
  constructor(public readonly name: string) {}
  appendLine(_message: string): void {
    // intentionally empty
  }
  append(_message: string): void {
    // intentionally empty
  }
  show(_preserveFocus?: boolean): void {
    // intentionally empty
  }
  hide(): void {
    // intentionally empty
  }
  clear(): void {
    // intentionally empty
  }
  replace(_value: string): void {
    // intentionally empty
  }
  dispose(): void {
    // intentionally empty
  }
}

const configState: Record<string, unknown> = {};

/** Test-only helper: seed values returned by `workspace.getConfiguration().get()`. */
export function setStubConfig(values: Record<string, unknown>): void {
  for (const k of Object.keys(configState)) delete configState[k];
  Object.assign(configState, values);
}

export const window = {
  createStatusBarItem(_alignment?: number, _priority?: number): FakeStatusBarItem {
    return new FakeStatusBarItem();
  },
  createOutputChannel(name: string): FakeOutputChannel {
    return new FakeOutputChannel(name);
  },
};

export const workspace = {
  getConfiguration(_section?: string) {
    return {
      get<T>(key: string, defaultValue: T): T {
        const stored = configState[key];
        return (stored as T | undefined) ?? defaultValue;
      },
    };
  },
};
