import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Clock3,
  Copy,
  Download,
  FileInput,
  KeyRound,
  Keyboard,
  Link,
  ListChecks,
  Plus,
  Save,
  ShieldCheck,
  Timer,
  Trash2,
  Type,
} from "lucide-react";
import {
  analyzeBadKBScript,
  buildBadKBExport,
  formatBadKBDuration,
  getBadKBTemplates,
  makeHotkeySnippet,
  makeOpenURLSnippet,
  makeTextSnippet,
  sanitizeBadKBFileName,
  type BadKBLayout,
  type BadKBIssue,
  type BadKBTarget,
} from "../badkb";
import "../badkb.css";

type BuilderTool = "text" | "delay" | "hotkey" | "url" | "key";

interface SavedProject {
  id: string;
  name: string;
  script: string;
  target: BadKBTarget;
  layout: BadKBLayout;
  defaultDelay: number;
  savedAt: string;
}

const PROJECTS_KEY = "flipforge.badkb.projects.v1";
const INITIAL_SCRIPT = "REM Flipforge authorized typing test\nDEFAULT_DELAY 100\nDELAY 1200\nSTRINGLN Flipforge BadKB test complete.";
const KEY_OPTIONS = ["ENTER", "TAB", "ESC", "SPACE", "UP", "DOWN", "LEFT", "RIGHT", "HOME", "END", "F5"];

function loadProjects(): SavedProject[] {
  try {
    const parsed = JSON.parse(window.localStorage.getItem(PROJECTS_KEY) ?? "[]") as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((entry): entry is SavedProject => Boolean(
      entry && typeof entry === "object" &&
      "id" in entry && typeof entry.id === "string" &&
      "name" in entry && typeof entry.name === "string" &&
      "script" in entry && typeof entry.script === "string" &&
      entry.script.length <= 100_000,
    )).slice(0, 12);
  } catch {
    return [];
  }
}

function severityLabel(issue: BadKBIssue): string {
  return issue.severity === "error" ? "BLOCKED" : issue.severity === "warning" ? "CHECK" : "NOTE";
}

export default function BadKBBuilder() {
  const [projectName, setProjectName] = useState("Untitled sequence");
  const [script, setScript] = useState(INITIAL_SCRIPT);
  const [target, setTarget] = useState<BadKBTarget>("windows");
  const [layout, setLayout] = useState<BadKBLayout>("us");
  const [defaultDelay, setDefaultDelay] = useState(100);
  const [tool, setTool] = useState<BuilderTool>("text");
  const [textValue, setTextValue] = useState("");
  const [delayValue, setDelayValue] = useState("1000");
  const [hotkeyValue, setHotkeyValue] = useState("CTRL SHIFT P");
  const [urlValue, setURLValue] = useState("https://docs.flipper.net/bad-usb");
  const [keyValue, setKeyValue] = useState("ENTER");
  const [notice, setNotice] = useState<string | null>(null);
  const [savedProjects, setSavedProjects] = useState<SavedProject[]>(loadProjects);
  const editorRef = useRef<HTMLTextAreaElement>(null);
  const lineNumbersRef = useRef<HTMLPreElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const analysis = useMemo(() => analyzeBadKBScript(script, defaultDelay), [defaultDelay, script]);
  const templates = useMemo(() => getBadKBTemplates(target), [target]);
  const lineNumbers = useMemo(() => script.split("\n").map((_, index) => index + 1).join("\n"), [script]);
  const errorCount = analysis.issues.filter((entry) => entry.severity === "error").length;
  const warningCount = analysis.issues.filter((entry) => entry.severity === "warning").length;

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2_400);
    return () => window.clearTimeout(timer);
  }, [notice]);

  const appendSnippet = (snippet: string) => {
    const next = script.trimEnd() ? `${script.trimEnd()}\n${snippet}\n` : `${snippet}\n`;
    setScript(next);
    window.requestAnimationFrame(() => {
      const editor = editorRef.current;
      if (!editor) return;
      editor.focus();
      editor.setSelectionRange(editor.value.length, editor.value.length);
    });
  };

  const addAction = () => {
    try {
      if (tool === "text") {
        if (!textValue.trim()) throw new Error("Enter the text to type first.");
        appendSnippet(makeTextSnippet(textValue));
        setTextValue("");
      } else if (tool === "delay") {
        const duration = Number(delayValue);
        if (!Number.isInteger(duration) || duration < 0 || duration > 600_000) throw new Error("Use a delay from 0 to 600,000 ms.");
        appendSnippet(`DELAY ${duration}`);
      } else if (tool === "hotkey") {
        appendSnippet(makeHotkeySnippet(hotkeyValue.split(/\s+/)));
      } else if (tool === "url") {
        appendSnippet(makeOpenURLSnippet(target, urlValue));
      } else {
        appendSnippet(keyValue);
      }
      setNotice("Action added to the sequence.");
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "That action could not be added.");
    }
  };

  const copyScript = async () => {
    if (!analysis.canExport) return;
    try {
      await navigator.clipboard.writeText(buildBadKBExport(script, { target, layout, defaultDelay }));
      setNotice("Script copied.");
    } catch {
      setNotice("Copy failed. Select the editor text and copy it manually.");
    }
  };

  const exportScript = () => {
    if (!analysis.canExport) return;
    const blob = new Blob([buildBadKBExport(script, { target, layout, defaultDelay })], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = sanitizeBadKBFileName(projectName);
    anchor.click();
    URL.revokeObjectURL(url);
    setNotice("BadKB script exported locally.");
  };

  const saveProject = () => {
    const now = new Date().toISOString();
    const existing = savedProjects.find((entry) => entry.name.toLowerCase() === projectName.trim().toLowerCase());
    const project: SavedProject = {
      id: existing?.id ?? crypto.randomUUID(),
      name: projectName.trim() || "Untitled sequence",
      script,
      target,
      layout,
      defaultDelay,
      savedAt: now,
    };
    const next = [project, ...savedProjects.filter((entry) => entry.id !== project.id)].slice(0, 12);
    try {
      window.localStorage.setItem(PROJECTS_KEY, JSON.stringify(next));
      setSavedProjects(next);
      setProjectName(project.name);
      setNotice("Project saved in this browser.");
    } catch {
      setNotice("Browser storage is unavailable. Export the project instead.");
    }
  };

  const loadProject = (project: SavedProject) => {
    setProjectName(project.name);
    setScript(project.script);
    setTarget(project.target);
    setLayout(project.layout);
    setDefaultDelay(project.defaultDelay);
    setNotice(`Loaded ${project.name}.`);
  };

  const deleteProject = (id: string) => {
    const next = savedProjects.filter((entry) => entry.id !== id);
    try {
      window.localStorage.setItem(PROJECTS_KEY, JSON.stringify(next));
      setSavedProjects(next);
      setNotice("Saved project removed.");
    } catch {
      setNotice("Browser storage is unavailable.");
    }
  };

  const importFile = async (file: File | undefined) => {
    if (!file) return;
    if (file.size > 100_000) {
      setNotice("BadKB files are limited to 100 KB.");
      return;
    }
    try {
      const contents = await file.text();
      setScript(contents.replace(/\r\n?/g, "\n"));
      setProjectName(file.name.replace(/\.txt$/i, "") || "Imported sequence");
      setNotice("Script imported locally. Nothing was uploaded.");
    } catch {
      setNotice("The selected text file could not be read.");
    }
  };

  const goToLine = (line: number) => {
    const editor = editorRef.current;
    if (!editor) return;
    const lines = editor.value.split("\n");
    const position = lines.slice(0, Math.max(0, line - 1)).reduce((total, value) => total + value.length + 1, 0);
    editor.focus();
    editor.setSelectionRange(position, position + (lines[line - 1]?.length ?? 0));
  };

  const syncEditorScroll = () => {
    if (lineNumbersRef.current && editorRef.current) lineNumbersRef.current.scrollTop = editorRef.current.scrollTop;
  };

  const resetProject = () => {
    setProjectName("Untitled sequence");
    setScript(INITIAL_SCRIPT);
    setNotice("New local project started.");
  };

  const toolButton = (value: BuilderTool, label: string, icon: React.ReactNode) => (
    <button className={tool === value ? "active" : ""} onClick={() => setTool(value)} aria-pressed={tool === value}>
      {icon}<span>{label}</span>
    </button>
  );

  return (
    <main className="badkb-page">
      <header className="badkb-intro">
        <div>
          <p className="eyebrow">BADKB WORKSPACE / LOCAL ONLY</p>
          <h1>Build the sequence.<br />See every keystroke.</h1>
          <p>Create authorized Flipper BadUSB automations with live timing, validation, and a structured action builder.</p>
        </div>
        <div className="badkb-safety-mark"><ShieldCheck /><span><strong>SAFE BUILDER</strong>Known high-risk patterns blocked</span></div>
      </header>

      <section className="badkb-status-strip" aria-label="Script summary">
        <span><b>{analysis.commandCount}</b>COMMANDS</span>
        <span><b>{analysis.keystrokeCount}</b>KEYSTROKES</span>
        <span><b>{formatBadKBDuration(analysis.estimatedDurationMs)}</b>ESTIMATED</span>
        <span className={errorCount ? "blocked" : warningCount ? "warning" : "clear"}>
          <b>{errorCount || warningCount || "CLEAR"}</b>{errorCount ? "BLOCKED" : warningCount ? "CHECKS" : "VALIDATION"}
        </span>
      </section>

      <div className="badkb-workspace">
        <section className="badkb-main" aria-label="BadKB script editor">
          <div className="badkb-project-bar">
            <label><span>PROJECT</span><input value={projectName} onChange={(event) => setProjectName(event.target.value)} maxLength={64} /></label>
            <div>
              <button onClick={resetProject}><Plus /> New</button>
              <button onClick={() => fileInputRef.current?.click()}><FileInput /> Import</button>
              <button onClick={saveProject}><Save /> Save local</button>
              <input ref={fileInputRef} type="file" accept=".txt,text/plain" hidden onChange={(event) => void importFile(event.target.files?.[0])} />
            </div>
          </div>

          <section className="badkb-composer" aria-labelledby="composer-title">
            <div className="badkb-section-heading"><span>ACTION BUILDER</span><strong id="composer-title">Add a safe command</strong></div>
            <div className="badkb-tool-tabs">
              {toolButton("text", "Type", <Type />)}
              {toolButton("delay", "Pause", <Timer />)}
              {toolButton("hotkey", "Hotkey", <KeyRound />)}
              {toolButton("url", "Website", <Link />)}
              {toolButton("key", "Key", <Keyboard />)}
            </div>
            <div className="badkb-tool-input">
              {tool === "text" && <textarea value={textValue} onChange={(event) => setTextValue(event.target.value)} placeholder="Text to type into the active field" rows={2} />}
              {tool === "delay" && <label><span>MILLISECONDS</span><input type="number" min="0" max="600000" value={delayValue} onChange={(event) => setDelayValue(event.target.value)} /></label>}
              {tool === "hotkey" && <label><span>KEY COMBINATION</span><input value={hotkeyValue} onChange={(event) => setHotkeyValue(event.target.value)} placeholder="CTRL SHIFT P" /></label>}
              {tool === "url" && <label><span>HTTP OR HTTPS URL</span><input type="url" value={urlValue} onChange={(event) => setURLValue(event.target.value)} /></label>}
              {tool === "key" && <label><span>KEY</span><select value={keyValue} onChange={(event) => setKeyValue(event.target.value)}>{KEY_OPTIONS.map((key) => <option key={key}>{key}</option>)}</select></label>}
              <button className="badkb-add-action" onClick={addAction}><Plus /> Add to sequence</button>
            </div>
          </section>

          <section className="badkb-code-section">
            <div className="badkb-section-heading">
              <span>DUCKYSCRIPT</span>
              <strong>Raw sequence</strong>
              <div><button onClick={copyScript} disabled={!analysis.canExport}><Copy /> Copy</button><button onClick={exportScript} disabled={!analysis.canExport}><Download /> Export .txt</button></div>
            </div>
            <div className="badkb-editor-shell">
              <pre ref={lineNumbersRef} aria-hidden="true">{lineNumbers}</pre>
              <textarea
                ref={editorRef}
                value={script}
                onChange={(event) => setScript(event.target.value)}
                onScroll={syncEditorScroll}
                spellCheck={false}
                aria-label="DuckyScript editor"
              />
            </div>
          </section>

          <section className="badkb-timeline" aria-labelledby="timeline-title">
            <div className="badkb-section-heading"><span>RUNTIME PREVIEW</span><strong id="timeline-title">Sequence timeline</strong></div>
            {analysis.timeline.length ? (
              <ol>
                {analysis.timeline.slice(0, 12).map((entry) => (
                  <li key={`${entry.line}-${entry.label}`}><span>{String(entry.line).padStart(2, "0")}</span><strong>{entry.label}</strong><time>{formatBadKBDuration(entry.durationMs)}</time></li>
                ))}
              </ol>
            ) : <p className="badkb-empty">Add a command to generate the runtime preview.</p>}
            {analysis.timeline.length > 12 && <p className="badkb-more">+ {analysis.timeline.length - 12} more commands</p>}
          </section>
        </section>

        <aside className="badkb-inspector" aria-label="BadKB project inspector">
          <section>
            <div className="badkb-section-heading"><span>PROFILE</span><strong>Target device</strong></div>
            <label><span>OPERATING SYSTEM</span><select value={target} onChange={(event) => setTarget(event.target.value as BadKBTarget)}><option value="windows">Windows</option><option value="macos">macOS</option><option value="linux">Linux</option><option value="universal">Browser / Universal</option></select></label>
            <label><span>KEYBOARD LAYOUT</span><select value={layout} onChange={(event) => setLayout(event.target.value as BadKBLayout)}><option value="us">US English</option><option value="uk">UK English</option><option value="de">German</option><option value="fr">French</option><option value="es">Spanish</option></select></label>
            <label><span>FALLBACK DELAY</span><div className="badkb-number-field"><input type="number" min="0" max="10000" value={defaultDelay} onChange={(event) => setDefaultDelay(Math.max(0, Math.min(10_000, Number(event.target.value))))} /><small>MS</small></div></label>
            <p className="badkb-profile-note">Target and layout are written into the exported file as project metadata. Set the matching keyboard layout on your Flipper before running it.</p>
          </section>

          <section>
            <div className="badkb-section-heading"><span>STARTERS</span><strong>Safe templates</strong></div>
            <div className="badkb-templates">
              {templates.map((template) => (
                <button key={template.id} onClick={() => { setProjectName(template.name); setScript(template.script); setNotice(`${template.name} loaded.`); }}>
                  <span><strong>{template.name}</strong><small>{template.description}</small></span><ChevronRight />
                </button>
              ))}
            </div>
          </section>

          <section className="badkb-validation">
            <div className="badkb-section-heading"><span>VALIDATION</span><strong>{errorCount ? `${errorCount} blocked` : warningCount ? `${warningCount} to check` : "Ready to export"}</strong></div>
            {analysis.issues.length ? (
              <div className="badkb-issues">
                {analysis.issues.slice(0, 8).map((entry, index) => (
                  <button key={`${entry.line}-${entry.message}-${index}`} className={`issue-${entry.severity}`} onClick={() => goToLine(entry.line)}>
                    {entry.severity === "error" ? <AlertTriangle /> : entry.severity === "warning" ? <Clock3 /> : <ListChecks />}
                    <span><small>{severityLabel(entry)} · LINE {entry.line}</small><strong>{entry.message}</strong></span>
                  </button>
                ))}
              </div>
            ) : <p className="badkb-valid"><Check /> No blocking issues found.</p>}
          </section>

          <section>
            <div className="badkb-section-heading"><span>THIS BROWSER</span><strong>Saved projects</strong></div>
            {savedProjects.length ? (
              <div className="badkb-saved-list">
                {savedProjects.map((project) => (
                  <div key={project.id}><button onClick={() => loadProject(project)}><strong>{project.name}</strong><small>{project.target.toUpperCase()} · {new Date(project.savedAt).toLocaleDateString()}</small></button><button aria-label={`Delete ${project.name}`} onClick={() => deleteProject(project.id)}><Trash2 /></button></div>
                ))}
              </div>
            ) : <p className="badkb-empty">No local projects saved yet.</p>}
          </section>

          <div className="badkb-privacy"><ShieldCheck /><p><strong>Local by design</strong>Your script stays in this browser. Nothing is compiled, executed, or uploaded.</p></div>
        </aside>
      </div>

      {notice && <div className="badkb-notice" role="status">{notice}</div>}
    </main>
  );
}
