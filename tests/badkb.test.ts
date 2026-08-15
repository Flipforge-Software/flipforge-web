import { describe, expect, it } from "vitest";
import {
  analyzeBadKBScript,
  buildBadKBExport,
  formatBadKBDuration,
  makeFocusNavigationSnippet,
  makeHotkeySnippet,
  makeOpenAppSnippet,
  makeOpenURLSnippet,
  makeTextSnippet,
  sanitizeBadKBFileName,
} from "../src/badkb";

describe("BadKB analyzer", () => {
  it("analyzes a safe script and estimates its runtime", () => {
    const result = analyzeBadKBScript("REM demo\nDEFAULT_DELAY 100\nDELAY 1000\nSTRING hello\nENTER");
    expect(result.canExport).toBe(true);
    expect(result.commandCount).toBe(4);
    expect(result.keystrokeCount).toBe(6);
    expect(result.estimatedDurationMs).toBe(1_240);
  });

  it("blocks shell, transfer, credential, persistence, and destructive content", () => {
    const result = analyzeBadKBScript([
      "STRING powershell -EncodedCommand AAAA",
      "STRING curl https://example.com",
      "STRING type Login Data",
      "STRING schtasks /create",
      "STRING rm -rf /",
    ].join("\n"));
    expect(result.canExport).toBe(false);
    expect(result.issues.filter((entry) => entry.severity === "error").length).toBeGreaterThanOrEqual(5);
  });

  it("does not scan comments as executable content", () => {
    const result = analyzeBadKBScript("REM powershell curl credential\nSTRING safe text");
    expect(result.canExport).toBe(true);
  });

  it("validates delay and repeat bounds", () => {
    const result = analyzeBadKBScript("DELAY 700000\nREPEAT 0");
    expect(result.canExport).toBe(false);
    expect(result.issues.filter((entry) => entry.severity === "error")).toHaveLength(2);
  });
});

describe("BadKB command builders", () => {
  it("builds multiline typing commands", () => {
    expect(makeTextSnippet("one\ntwo")).toBe("STRINGLN one\nSTRING two");
  });

  it("builds OS-aware URL launchers and rejects unsafe URL forms", () => {
    expect(makeOpenURLSnippet("windows", "https://flipper.net")).toContain("GUI r");
    expect(makeOpenURLSnippet("macos", "https://flipper.net")).toContain("GUI SPACE");
    expect(makeOpenURLSnippet("ios", "https://flipper.net")).toContain("GUI SPACE");
    expect(() => makeOpenURLSnippet("windows", "javascript:alert(1)")).toThrow("http or https");
    expect(() => makeOpenURLSnippet("windows", "https://user:pass@example.com")).toThrow("embedded credentials");
  });

  it("builds iPhone and iPad app-search sequences", () => {
    expect(makeOpenAppSnippet("ios", "Notes")).toBe("GUI SPACE\nDELAY 500\nSTRING Notes\nDELAY 500\nENTER");
    expect(() => makeOpenAppSnippet("universal", "Notes")).toThrow("specific operating system");
    expect(() => makeOpenAppSnippet("ios", "   ")).toThrow("app name");
  });

  it("builds safe hotkeys", () => {
    expect(makeHotkeySnippet(["ctrl", "shift", "p"])).toBe("CTRL SHIFT P");
    expect(() => makeHotkeySnippet(["ctrl", "unknown-key"])).toThrow("supported key");
  });

  it("builds bounded Full Keyboard Access focus movement", () => {
    expect(makeFocusNavigationSnippet("forward", 1)).toBe("TAB");
    expect(makeFocusNavigationSnippet("forward", 3)).toBe("TAB\nREPEAT 2");
    expect(makeFocusNavigationSnippet("backward", 3)).toBe("SHIFT TAB\nREPEAT 2");
    expect(() => makeFocusNavigationSnippet("forward", 0)).toThrow("between 1 and 50");
    expect(() => makeFocusNavigationSnippet("backward", 51)).toThrow("between 1 and 50");
  });

  it("sanitizes export filenames and formats duration", () => {
    expect(sanitizeBadKBFileName(" Demo Script ")).toBe("Demo-Script.txt");
    expect(sanitizeBadKBFileName("demo.txt")).toBe("demo.txt");
    expect(formatBadKBDuration(1_240)).toBe("1.2 s");
  });

  it("embeds the target profile and adds a missing fallback delay", () => {
    const output = buildBadKBExport("STRING hello", { target: "macos", layout: "uk", defaultDelay: 125 });
    expect(output).toContain("REM FLIPFORGE_PROFILE target=macos layout=uk");
    expect(output).toContain("DEFAULT_DELAY 125");
    expect(buildBadKBExport("DEFAULT_DELAY 50\nSTRING hello", { target: "windows", layout: "us", defaultDelay: 125 }).match(/DEFAULT_?DELAY/g)).toHaveLength(1);
  });

  it("exports the iPhone and iPad target profile", () => {
    expect(buildBadKBExport("STRING hello", { target: "ios", layout: "us", defaultDelay: 120 }))
      .toContain("REM FLIPFORGE_PROFILE target=ios layout=us");
  });
});
