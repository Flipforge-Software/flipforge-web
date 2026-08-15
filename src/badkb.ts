export type BadKBTarget = "ios" | "windows" | "macos" | "linux" | "universal";
export type BadKBLayout = "us" | "uk" | "de" | "fr" | "es";
export type BadKBFocusDirection = "forward" | "backward";
export type BadKBIssueSeverity = "error" | "warning" | "info";

export interface BadKBIssue {
  line: number;
  severity: BadKBIssueSeverity;
  message: string;
}

export interface BadKBTimelineEntry {
  line: number;
  label: string;
  durationMs: number;
}

export interface BadKBAnalysis {
  issues: BadKBIssue[];
  timeline: BadKBTimelineEntry[];
  lineCount: number;
  commandCount: number;
  keystrokeCount: number;
  estimatedDurationMs: number;
  canExport: boolean;
}

export interface BadKBTemplate {
  id: string;
  name: string;
  description: string;
  script: string;
}

export interface BadKBExportProfile {
  target: BadKBTarget;
  layout: BadKBLayout;
  defaultDelay: number;
}

const SAFE_KEY_COMMANDS = new Set([
  "ENTER", "ESC", "ESCAPE", "TAB", "SPACE", "BACKSPACE", "DELETE", "INSERT",
  "HOME", "END", "PAGEUP", "PAGEDOWN", "UP", "DOWN", "LEFT", "RIGHT",
  "CAPSLOCK", "NUMLOCK", "SCROLLLOCK", "PRINTSCREEN", "PAUSE", "BREAK",
  ...Array.from({ length: 12 }, (_, index) => `F${index + 1}`),
]);

const MODIFIERS = new Set(["CTRL", "CONTROL", "ALT", "SHIFT", "GUI", "WINDOWS", "COMMAND"]);

const RISK_RULES: Array<{ pattern: RegExp; message: string }> = [
  {
    pattern: /\b(?:powershell|pwsh|cmd(?:\.exe)?|bash|zsh|sh\s+-c|osascript|wscript|cscript|mshta|rundll32|regsvr32)\b/i,
    message: "Shell or script-launching commands are blocked by the safe builder.",
  },
  {
    pattern: /\b(?:curl|wget|invoke-webrequest|iwr|certutil|bitsadmin|netcat|nc\s+-)\b/i,
    message: "Network download and transfer commands are blocked by the safe builder.",
  },
  {
    pattern: /\b(?:rm\s+-rf|del\s+\/|format\s+[a-z]:|diskpart|mkfs|dd\s+if=|shutdown|reboot)\b/i,
    message: "Destructive or disruptive system commands are blocked.",
  },
  {
    pattern: /\b(?:net\s+user|schtasks|crontab|launchctl|systemctl\s+enable|startup)\b/i,
    message: "Account and persistence changes are blocked.",
  },
  {
    pattern: /(?:\.ssh|login\s+data|\/etc\/shadow|\\sam\b|\\security\b|keychain|credential)/i,
    message: "Credential and private-key access is blocked.",
  },
  {
    pattern: /\b(?:encodedcommand|frombase64string|base64|-[eE]nc)\b/i,
    message: "Encoded or obfuscated command execution is blocked.",
  },
];

function issue(line: number, severity: BadKBIssueSeverity, message: string): BadKBIssue {
  return { line, severity, message };
}

function parsePositiveInteger(value: string): number | null {
  if (!/^\d+$/.test(value.trim())) return null;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) && parsed >= 0 ? parsed : null;
}

function isSafeKeySequence(command: string): boolean {
  const tokens = command.toUpperCase().split(/\s+/).filter(Boolean);
  if (!tokens.length) return false;
  if (tokens.length === 1) return SAFE_KEY_COMMANDS.has(tokens[0]);
  return tokens.slice(0, -1).every((token) => MODIFIERS.has(token)) &&
    (SAFE_KEY_COMMANDS.has(tokens.at(-1) ?? "") || /^[A-Z0-9]$/.test(tokens.at(-1) ?? ""));
}

export function analyzeBadKBScript(script: string, startingDefaultDelay = 100): BadKBAnalysis {
  const lines = script.replace(/\r\n?/g, "\n").split("\n");
  const issues: BadKBIssue[] = [];
  const timeline: BadKBTimelineEntry[] = [];
  let defaultDelay = Math.max(0, Math.min(10_000, startingDefaultDelay));
  let commandCount = 0;
  let keystrokeCount = 0;
  let estimatedDurationMs = 0;
  let previousDuration = 0;

  if (script.length > 100_000) {
    issues.push(issue(1, "error", "Scripts are limited to 100 KB."));
  }

  lines.forEach((rawLine, index) => {
    const lineNumber = index + 1;
    const line = rawLine.trim();
    if (!line || line.startsWith("REM")) return;

    for (const rule of RISK_RULES) {
      if (rule.pattern.test(line)) issues.push(issue(lineNumber, "error", rule.message));
    }

    const firstSpace = line.indexOf(" ");
    const command = (firstSpace === -1 ? line : line.slice(0, firstSpace)).toUpperCase();
    const argument = firstSpace === -1 ? "" : line.slice(firstSpace + 1);
    let duration = defaultDelay;
    let label = command;

    if (command === "DEFAULT_DELAY" || command === "DEFAULTDELAY") {
      const value = parsePositiveInteger(argument);
      if (value === null || value > 10_000) {
        issues.push(issue(lineNumber, "error", "Default delay must be between 0 and 10,000 ms."));
      } else {
        defaultDelay = value;
        duration = 0;
        label = `Default delay · ${value} ms`;
      }
    } else if (command === "DELAY") {
      const value = parsePositiveInteger(argument);
      if (value === null || value > 600_000) {
        issues.push(issue(lineNumber, "error", "Delay must be between 0 and 600,000 ms."));
        duration = 0;
      } else {
        duration = value;
        label = `Pause · ${value} ms`;
      }
    } else if (command === "STRING" || command === "STRINGLN") {
      const typedCharacters = argument.length + (command === "STRINGLN" ? 1 : 0);
      keystrokeCount += typedCharacters;
      duration += typedCharacters * 8;
      label = `${command === "STRINGLN" ? "Type + Enter" : "Type text"} · ${typedCharacters} keys`;
    } else if (command === "REPEAT") {
      const value = parsePositiveInteger(argument);
      if (value === null || value < 1 || value > 1_000 || timeline.length === 0) {
        issues.push(issue(lineNumber, "error", "Repeat requires a previous command and a count from 1 to 1,000."));
        duration = 0;
      } else {
        duration = previousDuration * value;
        label = `Repeat previous · ${value}×`;
      }
    } else if (command === "WAIT_FOR_BUTTON_PRESS") {
      duration = 0;
      label = "Wait for Flipper button";
      issues.push(issue(lineNumber, "info", "Runtime pauses here until you press the Flipper button."));
    } else if (command === "ID") {
      issues.push(issue(lineNumber, "error", "USB identity spoofing is not available in the safe builder."));
    } else if (isSafeKeySequence(line)) {
      keystrokeCount += line.split(/\s+/).length;
      label = `Press · ${line.toUpperCase()}`;
    } else {
      issues.push(issue(lineNumber, "warning", `Unknown command: ${command}`));
      label = `Unknown · ${command}`;
    }

    commandCount += 1;
    previousDuration = duration;
    estimatedDurationMs += duration;
    timeline.push({ line: lineNumber, label, durationMs: duration });
  });

  if (commandCount === 0) issues.push(issue(1, "warning", "Add at least one command before exporting."));

  return {
    issues,
    timeline,
    lineCount: lines.length,
    commandCount,
    keystrokeCount,
    estimatedDurationMs,
    canExport: commandCount > 0 && !issues.some((entry) => entry.severity === "error"),
  };
}

export function makeTextSnippet(text: string): string {
  const normalized = text.replace(/\r\n?/g, "\n");
  return normalized
    .split("\n")
    .map((line, index, lines) => `${index < lines.length - 1 ? "STRINGLN" : "STRING"} ${line}`.trimEnd())
    .join("\n");
}

export function makeOpenURLSnippet(target: BadKBTarget, value: string): string {
  const url = new URL(value);
  if (!["http:", "https:"].includes(url.protocol) || url.username || url.password || value.length > 2_048) {
    throw new Error("Use a normal http or https URL without embedded credentials.");
  }

  const launcher = target === "windows" ? "GUI r" : target === "ios" || target === "macos" ? "GUI SPACE" : target === "linux" ? "GUI" : "CTRL L";
  return `${launcher}\nDELAY 500\nSTRING ${url.toString()}\nENTER`;
}

export function makeOpenAppSnippet(target: BadKBTarget, value: string): string {
  const appName = value.replace(/[\r\n]/g, " ").trim();
  if (!appName || appName.length > 80) throw new Error("Enter an app name up to 80 characters.");
  if (target === "universal") throw new Error("Choose a specific operating system before opening an app.");

  const launcher = target === "windows" || target === "linux" ? "GUI" : "GUI SPACE";
  return `${launcher}\nDELAY 500\nSTRING ${appName}\nDELAY 500\nENTER`;
}

export function makeHotkeySnippet(keys: string[]): string {
  const normalized = keys.map((key) => key.trim().toUpperCase()).filter(Boolean).join(" ");
  if (!isSafeKeySequence(normalized)) throw new Error("Choose modifiers followed by one letter, number, or supported key.");
  return normalized;
}

export function makeFocusNavigationSnippet(direction: BadKBFocusDirection, count: number): string {
  if (!Number.isInteger(count) || count < 1 || count > 50) {
    throw new Error("Focus movement must be between 1 and 50 steps.");
  }

  const command = direction === "backward" ? "SHIFT TAB" : "TAB";
  return count === 1 ? command : `${command}\nREPEAT ${count - 1}`;
}

export function getBadKBTemplates(target: BadKBTarget): BadKBTemplate[] {
  if (target === "ios") {
    return [
      {
        id: "ios-hello",
        name: "iPhone typing test",
        description: "Types a harmless confirmation into the active text field.",
        script: "REM iPhone and iPad typing test\nDEFAULT_DELAY 120\nDELAY 1200\nSTRINGLN Flipforge keyboard test complete.",
      },
      {
        id: "ios-docs",
        name: "Open Flipper docs",
        description: "Uses iOS Search to open the official Flipper documentation.",
        script: `REM Open official Flipper documentation on iOS\nDEFAULT_DELAY 120\nDELAY 1200\n${makeOpenURLSnippet(target, "https://docs.flipper.net/bad-usb")}`,
      },
      {
        id: "ios-notes",
        name: "Open Notes",
        description: "Uses Command-Space Search to open the Notes app.",
        script: `REM Open Notes on iPhone or iPad\nDEFAULT_DELAY 120\nDELAY 1200\n${makeOpenAppSnippet(target, "Notes")}`,
      },
    ];
  }

  return [
    {
      id: "hello",
      name: "Typing test",
      description: "Types a harmless confirmation message into the active field.",
      script: "REM Flipforge typing test\nDEFAULT_DELAY 100\nDELAY 1200\nSTRINGLN Flipforge BadKB test complete.",
    },
    {
      id: "docs",
      name: "Open Flipper docs",
      description: "Opens the official BadUSB documentation using the selected OS launcher.",
      script: `REM Open official Flipper documentation\nDEFAULT_DELAY 100\nDELAY 1200\n${makeOpenURLSnippet(target, "https://docs.flipper.net/bad-usb")}`,
    },
    {
      id: "presentation",
      name: "Presentation remote",
      description: "Starts a presentation, advances once, then waits for physical confirmation.",
      script: "REM Presentation helper\nDEFAULT_DELAY 120\nDELAY 1200\nF5\nDELAY 1500\nRIGHT\nWAIT_FOR_BUTTON_PRESS",
    },
  ];
}

export function sanitizeBadKBFileName(value: string): string {
  const clean = value.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 64);
  return `${clean || "flipforge-badkb"}.txt`.replace(/\.txt\.txt$/i, ".txt");
}

export function buildBadKBExport(script: string, profile: BadKBExportProfile): string {
  const normalized = script.replace(/\r\n?/g, "\n").trim();
  const delay = Math.max(0, Math.min(10_000, Math.round(profile.defaultDelay)));
  const hasDefaultDelay = /^\s*DEFAULT_?DELAY\s+\d+/im.test(normalized);
  return [
    `REM FLIPFORGE_PROFILE target=${profile.target} layout=${profile.layout}`,
    hasDefaultDelay ? "" : `DEFAULT_DELAY ${delay}`,
    normalized,
    "",
  ].filter((line, index, lines) => line || index === lines.length - 1).join("\n");
}

export function formatBadKBDuration(milliseconds: number): string {
  if (milliseconds < 1_000) return `${milliseconds} ms`;
  if (milliseconds < 60_000) return `${(milliseconds / 1_000).toFixed(milliseconds < 10_000 ? 1 : 0)} s`;
  const minutes = Math.floor(milliseconds / 60_000);
  const seconds = Math.round((milliseconds % 60_000) / 1_000);
  return `${minutes}m ${seconds}s`;
}
