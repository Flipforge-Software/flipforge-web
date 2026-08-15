import { useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  AppWindow,
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
  GripVertical,
  ArrowDown,
  ArrowUp,
  CopyPlus,
  Plus,
  Save,
  ShieldCheck,
  SlidersHorizontal,
  Smartphone,
  Timer,
  Trash2,
  Type,
  WandSparkles,
} from "lucide-react";
import {
  analyzeBadKBScript,
  buildBadKBExport,
  formatBadKBDuration,
  getBadKBTemplates,
  makeHotkeySnippet,
  makeOpenAppSnippet,
  makeOpenURLSnippet,
  makeTextSnippet,
  sanitizeBadKBFileName,
  type BadKBLayout,
  type BadKBIssue,
  type BadKBTarget,
} from "../badkb";
import "../badkb.css";

type BuilderMode = "simple" | "advanced";
type BuilderTool = "text" | "url" | "app" | "delay" | "hotkey" | "key";

interface SavedProject {
  id: string;
  name: string;
  script: string;
  target: BadKBTarget;
  layout: BadKBLayout;
  defaultDelay: number;
  savedAt: string;
  mode?: BuilderMode;
  blocks?: SimpleBlock[];
}

interface SimpleBlock {
  id: string;
  type: BuilderTool;
  value: string;
}

interface CompiledSimpleBlock {
  snippet: string;
  error: string | null;
}

const PROJECTS_KEY = "flipforge.badkb.projects.v1";
const INITIAL_SCRIPT = "REM Flipforge guided BadKB sequence";
const KEY_OPTIONS = ["ENTER", "TAB", "ESC", "SPACE", "UP", "DOWN", "LEFT", "RIGHT", "HOME", "END", "F5"];
const BLOCK_DEFAULTS: Record<BuilderTool, string> = {
  text: "Hello from Flipforge",
  url: "https://docs.flipper.net/bad-usb",
  app: "Notes",
  delay: "1000",
  hotkey: "GUI SPACE",
  key: "ENTER",
};

function isSimpleBlock(value: unknown): value is SimpleBlock {
  if (!value || typeof value !== "object") return false;
  const entry = value as Partial<SimpleBlock>;
  return typeof entry.id === "string" &&
    ["text", "url", "app", "delay", "hotkey", "key"].includes(entry.type ?? "") &&
    typeof entry.value === "string";
}

function compileSimpleBlock(block: SimpleBlock, target: BadKBTarget): CompiledSimpleBlock {
  try {
    if (block.type === "text") {
      if (!block.value.trim()) throw new Error("Enter the text this block should type.");
      return { snippet: makeTextSnippet(block.value), error: null };
    }
    if (block.type === "url") return { snippet: makeOpenURLSnippet(target, block.value), error: null };
    if (block.type === "app") return { snippet: makeOpenAppSnippet(target, block.value), error: null };
    if (block.type === "delay") {
      const duration = Number(block.value);
      if (!Number.isInteger(duration) || duration < 0 || duration > 600_000) throw new Error("Use a wait from 0 to 600,000 ms.");
      return { snippet: `DELAY ${duration}`, error: null };
    }
    if (block.type === "hotkey") return { snippet: makeHotkeySnippet(block.value.split(/\s+/)), error: null };
    return { snippet: block.value, error: null };
  } catch (reason) {
    return { snippet: "", error: reason instanceof Error ? reason.message : "This block needs attention." };
  }
}

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

function blockLabel(type: BuilderTool): string {
  if (type === "text") return "Type text";
  if (type === "url") return "Open website";
  if (type === "app") return "Open app";
  if (type === "delay") return "Wait";
  if (type === "hotkey") return "Keyboard shortcut";
  return "Press key";
}

function blockDescription(type: BuilderTool): string {
  if (type === "text") return "Types into the active field";
  if (type === "url") return "Opens a safe web address";
  if (type === "app") return "Finds an installed app";
  if (type === "delay") return "Pauses the sequence";
  if (type === "hotkey") return "Presses multiple keys together";
  return "Presses one supported key";
}

function blockIcon(type: BuilderTool): React.ReactNode {
  if (type === "text") return <Type />;
  if (type === "url") return <Link />;
  if (type === "app") return <AppWindow />;
  if (type === "delay") return <Timer />;
  if (type === "hotkey") return <KeyRound />;
  return <Keyboard />;
}

export default function BadKBBuilder() {
  const [projectName, setProjectName] = useState("Untitled sequence");
  const [script, setScript] = useState(INITIAL_SCRIPT);
  const [mode, setMode] = useState<BuilderMode>("simple");
  const [target, setTarget] = useState<BadKBTarget>("ios");
  const [layout, setLayout] = useState<BadKBLayout>("us");
  const [defaultDelay, setDefaultDelay] = useState(100);
  const [tool, setTool] = useState<BuilderTool>("text");
  const [textValue, setTextValue] = useState("");
  const [delayValue, setDelayValue] = useState("1000");
  const [hotkeyValue, setHotkeyValue] = useState("CTRL SHIFT P");
  const [urlValue, setURLValue] = useState("https://docs.flipper.net/bad-usb");
  const [appValue, setAppValue] = useState("Notes");
  const [keyValue, setKeyValue] = useState("ENTER");
  const [simpleBlocks, setSimpleBlocks] = useState<SimpleBlock[]>([]);
  const [simpleSequenceActive, setSimpleSequenceActive] = useState(false);
  const [draggedBlockID, setDraggedBlockID] = useState<string | null>(null);
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
  const compiledSimpleBlocks = useMemo(
    () => simpleBlocks.map((block) => compileSimpleBlock(block, target)),
    [simpleBlocks, target],
  );
  const simpleErrorCount = compiledSimpleBlocks.filter((entry) => entry.error).length;
  const hasUnsyncedAdvancedScript = !simpleSequenceActive && simpleBlocks.length === 0 && analysis.commandCount > 0;
  const canExportProject = analysis.canExport && (mode === "advanced" || (simpleSequenceActive && simpleBlocks.length > 0 && simpleErrorCount === 0));
  const projectErrorCount = errorCount + (mode === "simple" ? simpleErrorCount : 0);

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2_400);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    if (!simpleSequenceActive) return;
    const snippets = compiledSimpleBlocks.map((entry, index) => entry.error ? `REM Block ${index + 1} needs attention` : entry.snippet);
    setScript([INITIAL_SCRIPT, ...snippets].join("\n"));
  }, [compiledSimpleBlocks, simpleSequenceActive]);

  const appendSnippet = (snippet: string) => {
    const next = script.trimEnd() ? `${script.trimEnd()}\n${snippet}\n` : `${snippet}\n`;
    setSimpleBlocks([]);
    setSimpleSequenceActive(false);
    setScript(next);
    if (mode !== "advanced") return;
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
      } else if (tool === "app") {
        appendSnippet(makeOpenAppSnippet(target, appValue));
      } else {
        appendSnippet(keyValue);
      }
      setNotice("Action added to the sequence.");
    } catch (reason) {
      setNotice(reason instanceof Error ? reason.message : "That action could not be added.");
    }
  };

  const copyScript = async () => {
    if (!canExportProject) return;
    try {
      await navigator.clipboard.writeText(buildBadKBExport(script, { target, layout, defaultDelay }));
      setNotice("Script copied.");
    } catch {
      setNotice("Copy failed. Select the editor text and copy it manually.");
    }
  };

  const exportScript = () => {
    if (!canExportProject) return;
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
      mode,
      blocks: simpleSequenceActive ? simpleBlocks : undefined,
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
    const restoredBlocks = project.blocks?.filter(isSimpleBlock) ?? [];
    setSimpleBlocks(restoredBlocks);
    setSimpleSequenceActive(restoredBlocks.length > 0);
    setMode(restoredBlocks.length ? "simple" : project.mode ?? "advanced");
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
      setSimpleBlocks([]);
      setSimpleSequenceActive(false);
      setMode("advanced");
      setProjectName(file.name.replace(/\.txt$/i, "") || "Imported sequence");
      setNotice("Script imported locally. Nothing was uploaded.");
    } catch {
      setNotice("The selected text file could not be read.");
    }
  };

  const goToLine = (line: number) => {
    const selectLine = () => {
      const editor = editorRef.current;
      if (!editor) return;
      const lines = editor.value.split("\n");
      const position = lines.slice(0, Math.max(0, line - 1)).reduce((total, value) => total + value.length + 1, 0);
      editor.focus();
      editor.setSelectionRange(position, position + (lines[line - 1]?.length ?? 0));
    };

    if (editorRef.current) {
      selectLine();
      return;
    }

    setMode("advanced");
    window.requestAnimationFrame(() => window.requestAnimationFrame(selectLine));
  };

  const syncEditorScroll = () => {
    if (lineNumbersRef.current && editorRef.current) lineNumbersRef.current.scrollTop = editorRef.current.scrollTop;
  };

  const resetProject = () => {
    setProjectName("Untitled sequence");
    setScript(INITIAL_SCRIPT);
    setSimpleBlocks([]);
    setSimpleSequenceActive(false);
    setNotice("New local project started.");
  };

  const changeTarget = (nextTarget: BadKBTarget) => {
    setTarget(nextTarget);
    if (nextTarget === "ios") {
      setHotkeyValue("GUI SPACE");
      setAppValue("Notes");
    }
  };

  const loadTemplate = (name: string, templateScript: string) => {
    setProjectName(name);
    setScript(templateScript);
    setSimpleBlocks([]);
    setSimpleSequenceActive(false);
    setMode("advanced");
    setNotice(`${name} loaded in Advanced mode.`);
  };

  const addSimpleBlock = (type: BuilderTool) => {
    if (hasUnsyncedAdvancedScript) {
      setNotice("Start a new visual sequence or return to Advanced mode first.");
      return;
    }
    const block: SimpleBlock = { id: crypto.randomUUID(), type, value: BLOCK_DEFAULTS[type] };
    setSimpleBlocks((blocks) => [...blocks, block]);
    setSimpleSequenceActive(true);
    setNotice(`${type === "url" ? "Website" : type === "delay" ? "Wait" : type[0].toUpperCase() + type.slice(1)} block added.`);
  };

  const startVisualSequence = () => {
    setScript(INITIAL_SCRIPT);
    setSimpleBlocks([]);
    setSimpleSequenceActive(false);
    setNotice("New visual sequence started.");
  };

  const updateSimpleBlock = (id: string, value: string) => {
    setSimpleBlocks((blocks) => blocks.map((block) => block.id === id ? { ...block, value } : block));
  };

  const removeSimpleBlock = (id: string) => {
    setSimpleBlocks((blocks) => blocks.filter((block) => block.id !== id));
    setNotice("Block removed.");
  };

  const duplicateSimpleBlock = (id: string) => {
    setSimpleBlocks((blocks) => {
      const index = blocks.findIndex((block) => block.id === id);
      if (index < 0) return blocks;
      const next = [...blocks];
      next.splice(index + 1, 0, { ...blocks[index], id: crypto.randomUUID() });
      return next;
    });
    setNotice("Block duplicated.");
  };

  const moveSimpleBlock = (id: string, direction: -1 | 1) => {
    setSimpleBlocks((blocks) => {
      const index = blocks.findIndex((block) => block.id === id);
      const destination = index + direction;
      if (index < 0 || destination < 0 || destination >= blocks.length) return blocks;
      const next = [...blocks];
      [next[index], next[destination]] = [next[destination], next[index]];
      return next;
    });
  };

  const dropSimpleBlock = (targetID: string) => {
    if (!draggedBlockID || draggedBlockID === targetID) return;
    setSimpleBlocks((blocks) => {
      const sourceIndex = blocks.findIndex((block) => block.id === draggedBlockID);
      const targetIndex = blocks.findIndex((block) => block.id === targetID);
      if (sourceIndex < 0 || targetIndex < 0) return blocks;
      const next = [...blocks];
      const [moved] = next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, moved);
      return next;
    });
    setDraggedBlockID(null);
  };

  const toolButton = (value: BuilderTool, label: string, icon: React.ReactNode) => (
    <button className={tool === value ? "active" : ""} onClick={() => setTool(value)} aria-label={label} aria-pressed={tool === value}>
      {icon}<span>{label}</span>
    </button>
  );

  const actionInput = (
    <div className="badkb-tool-input">
      {tool === "text" && <label><span>WHAT SHOULD IT TYPE?</span><textarea value={textValue} onChange={(event) => setTextValue(event.target.value)} placeholder="Text to type into the active field" rows={2} /></label>}
      {tool === "url" && <label><span>WHICH WEBSITE SHOULD IT OPEN?</span><input type="url" value={urlValue} onChange={(event) => setURLValue(event.target.value)} placeholder="https://example.com" /></label>}
      {tool === "app" && <label><span>WHICH APP SHOULD IT OPEN?</span><input value={appValue} onChange={(event) => setAppValue(event.target.value)} placeholder={target === "ios" ? "Notes" : "App name"} maxLength={80} /></label>}
      {tool === "delay" && <label><span>HOW LONG SHOULD IT WAIT?</span><div className="badkb-number-field"><input type="number" min="0" max="600000" value={delayValue} onChange={(event) => setDelayValue(event.target.value)} /><small>MS</small></div></label>}
      {tool === "hotkey" && <label><span>WHICH SHORTCUT SHOULD IT PRESS?</span><input value={hotkeyValue} onChange={(event) => setHotkeyValue(event.target.value)} placeholder={target === "ios" ? "GUI SPACE" : "CTRL SHIFT P"} /></label>}
      {tool === "key" && <label><span>WHICH KEY SHOULD IT PRESS?</span><select value={keyValue} onChange={(event) => setKeyValue(event.target.value)}>{KEY_OPTIONS.map((key) => <option key={key}>{key}</option>)}</select></label>}
      <button className="badkb-add-action" onClick={addAction}><Plus /> Add step</button>
    </div>
  );

  return (
    <main className="badkb-page">
      <header className="badkb-intro">
        <div>
          <p className="eyebrow">BADKB WORKSPACE / LOCAL ONLY</p>
          <h1>{mode === "simple" ? <>Tell it what<br />to do.</> : <>Build the sequence.<br />See every keystroke.</>}</h1>
          <p>{mode === "simple" ? "Stack readable actions, edit them in place, and Flipforge writes the safe BadUSB commands for you." : "Write and inspect authorized Flipper BadUSB automations with raw DuckyScript, live timing, and line-specific validation."}</p>
        </div>
        <div className="badkb-intro-aside">
          <div className="badkb-mode-switch" aria-label="Builder mode">
            <button className={mode === "simple" ? "active" : ""} onClick={() => setMode("simple")} aria-pressed={mode === "simple"}><WandSparkles /><span><strong>Simple</strong><small>Guided actions</small></span></button>
            <button className={mode === "advanced" ? "active" : ""} onClick={() => setMode("advanced")} aria-pressed={mode === "advanced"}><SlidersHorizontal /><span><strong>Advanced</strong><small>Raw control</small></span></button>
          </div>
          <div className="badkb-safety-mark"><ShieldCheck /><span><strong>SAFE BUILDER</strong>Known high-risk patterns blocked</span></div>
        </div>
      </header>

      <section className="badkb-status-strip" aria-label="Script summary">
        <span><b>{analysis.commandCount}</b>COMMANDS</span>
        <span><b>{analysis.keystrokeCount}</b>KEYSTROKES</span>
        <span><b>{formatBadKBDuration(analysis.estimatedDurationMs)}</b>ESTIMATED</span>
        <span className={projectErrorCount ? "blocked" : warningCount ? "warning" : "clear"}>
          <b>{projectErrorCount || warningCount || "CLEAR"}</b>{projectErrorCount ? "BLOCKED" : warningCount ? "CHECKS" : "VALIDATION"}
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

          {mode === "simple" ? (
            <section className="badkb-simple-builder" aria-labelledby="simple-builder-title">
              <div className="badkb-section-heading"><span>VISUAL BUILDER</span><strong id="simple-builder-title">Build with blocks</strong></div>
              <div className="badkb-block-workspace">
                <aside className="badkb-block-library" aria-label="Action library">
                  <div><span>ACTION LIBRARY</span><strong>What should happen?</strong><small>Tap a block to add it to the bottom of your sequence.</small></div>
                  <nav id="badkb-block-library">
                    {(["text", "url", "app", "delay", "hotkey", "key"] as BuilderTool[]).map((type) => (
                      <button key={type} onClick={() => addSimpleBlock(type)} disabled={hasUnsyncedAdvancedScript}>
                        <span>{blockIcon(type)}</span><span><strong>{blockLabel(type)}</strong><small>{blockDescription(type)}</small></span><Plus />
                      </button>
                    ))}
                  </nav>
                </aside>

                <div className="badkb-block-canvas">
                  <header><span>YOUR SEQUENCE</span><strong>{simpleBlocks.length ? `${simpleBlocks.length} ${simpleBlocks.length === 1 ? "step" : "steps"}` : "No steps yet"}</strong><small>{simpleBlocks.length ? "Drag blocks or use the arrows to change the order." : "Choose an action from the library to begin."}</small></header>
                  {simpleBlocks.length ? (
                    <ol className="badkb-block-stack">
                      {simpleBlocks.map((block, index) => {
                        const compiled = compiledSimpleBlocks[index];
                        return (
                          <li
                            key={block.id}
                            className={draggedBlockID === block.id ? "dragging" : ""}
                            onDragOver={(event) => event.preventDefault()}
                            onDrop={() => dropSimpleBlock(block.id)}
                          >
                            <article className={compiled?.error ? "has-error" : ""}>
                              <header>
                                <span className="badkb-block-icon">{blockIcon(block.type)}</span>
                                <span><small>STEP {String(index + 1).padStart(2, "0")}</small><strong>{blockLabel(block.type)}</strong></span>
                                <button
                                  className="badkb-drag-handle"
                                  draggable
                                  onDragStart={() => setDraggedBlockID(block.id)}
                                  onDragEnd={() => setDraggedBlockID(null)}
                                  aria-label={`Drag ${blockLabel(block.type)} block`}
                                  title="Drag to reorder"
                                ><GripVertical /></button>
                              </header>
                              <div className="badkb-block-body">
                                {block.type === "text" && <textarea value={block.value} onChange={(event) => updateSimpleBlock(block.id, event.target.value)} rows={2} aria-label={`Text for step ${index + 1}`} />}
                                {block.type === "url" && <input type="url" value={block.value} onChange={(event) => updateSimpleBlock(block.id, event.target.value)} aria-label={`Website for step ${index + 1}`} />}
                                {block.type === "app" && <input value={block.value} onChange={(event) => updateSimpleBlock(block.id, event.target.value)} maxLength={80} aria-label={`App for step ${index + 1}`} />}
                                {block.type === "delay" && <label><input type="number" min="0" max="600000" value={block.value} onChange={(event) => updateSimpleBlock(block.id, event.target.value)} aria-label={`Wait time for step ${index + 1}`} /><small>MS</small></label>}
                                {block.type === "hotkey" && <input value={block.value} onChange={(event) => updateSimpleBlock(block.id, event.target.value)} aria-label={`Shortcut for step ${index + 1}`} />}
                                {block.type === "key" && <select value={block.value} onChange={(event) => updateSimpleBlock(block.id, event.target.value)} aria-label={`Key for step ${index + 1}`}>{KEY_OPTIONS.map((key) => <option key={key}>{key}</option>)}</select>}
                                {compiled?.error && <p><AlertTriangle /> {compiled.error}</p>}
                              </div>
                              <footer>
                                <span>{compiled?.error ? "NEEDS ATTENTION" : "READY"}</span>
                                <div>
                                  <button onClick={() => moveSimpleBlock(block.id, -1)} disabled={index === 0} aria-label={`Move step ${index + 1} up`}><ArrowUp /></button>
                                  <button onClick={() => moveSimpleBlock(block.id, 1)} disabled={index === simpleBlocks.length - 1} aria-label={`Move step ${index + 1} down`}><ArrowDown /></button>
                                  <button onClick={() => duplicateSimpleBlock(block.id)} aria-label={`Duplicate step ${index + 1}`}><CopyPlus /></button>
                                  <button onClick={() => removeSimpleBlock(block.id)} aria-label={`Delete step ${index + 1}`}><Trash2 /></button>
                                </div>
                              </footer>
                            </article>
                          </li>
                        );
                      })}
                    </ol>
                  ) : (
                    <div className="badkb-block-empty">
                      {hasUnsyncedAdvancedScript ? <SlidersHorizontal /> : <WandSparkles />}
                      <strong>{hasUnsyncedAdvancedScript ? "This is an Advanced script" : "Your sequence starts here"}</strong>
                      <p>{hasUnsyncedAdvancedScript ? "Custom DuckyScript cannot always be converted into safe visual blocks. Keep editing it in Advanced, or start a new visual sequence." : "Choose “Type text,” “Open website,” or another action. Flipforge connects the blocks and writes the script."}</p>
                      {hasUnsyncedAdvancedScript && <div><button onClick={() => setMode("advanced")}>Return to Advanced</button><button className="primary" onClick={startVisualSequence}>Start visual sequence</button></div>}
                    </div>
                  )}
                </div>
              </div>
              <div className="badkb-simple-export">
                <span><strong>{canExportProject ? "Sequence ready" : simpleErrorCount ? `${simpleErrorCount} ${simpleErrorCount === 1 ? "block needs" : "blocks need"} attention` : "Add your first block"}</strong><small>{canExportProject ? "Copy it or save the .txt file for the Flipper Bad USB app." : "Every block must be valid before export."}</small></span>
                <div><button onClick={copyScript} disabled={!canExportProject}><Copy /> Copy</button><button className="primary" onClick={exportScript} disabled={!canExportProject}><Download /> Export .txt</button></div>
              </div>
            </section>
          ) : (
            <section className="badkb-composer" aria-labelledby="composer-title">
              <div className="badkb-section-heading"><span>ACTION BUILDER</span><strong id="composer-title">Add a safe command</strong></div>
              <div className="badkb-tool-tabs">
                {toolButton("text", "Type", <Type />)}
                {toolButton("url", "Website", <Link />)}
                {toolButton("app", "App", <AppWindow />)}
                {toolButton("delay", "Pause", <Timer />)}
                {toolButton("hotkey", "Hotkey", <KeyRound />)}
                {toolButton("key", "Key", <Keyboard />)}
              </div>
              {actionInput}
            </section>
          )}

          {mode === "advanced" && (
            <section className="badkb-code-section">
              <div className="badkb-section-heading">
                <span>DUCKYSCRIPT</span>
                <strong>Raw sequence</strong>
                <div><button onClick={copyScript} disabled={!canExportProject}><Copy /> Copy</button><button onClick={exportScript} disabled={!canExportProject}><Download /> Export .txt</button></div>
              </div>
              <div className="badkb-editor-shell">
                <pre ref={lineNumbersRef} aria-hidden="true">{lineNumbers}</pre>
                <textarea
                  ref={editorRef}
                  value={script}
                  onChange={(event) => { setScript(event.target.value); setSimpleBlocks([]); setSimpleSequenceActive(false); }}
                  onScroll={syncEditorScroll}
                  spellCheck={false}
                  aria-label="DuckyScript editor"
                />
              </div>
            </section>
          )}

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
            <label><span>OPERATING SYSTEM</span><select value={target} onChange={(event) => changeTarget(event.target.value as BadKBTarget)}><option value="ios">iPhone / iPad</option><option value="windows">Windows</option><option value="macos">macOS</option><option value="linux">Linux</option><option value="universal">Browser / Universal</option></select></label>
            <label><span>KEYBOARD LAYOUT</span><select value={layout} onChange={(event) => setLayout(event.target.value as BadKBLayout)}><option value="us">US English</option><option value="uk">UK English</option><option value="de">German</option><option value="fr">French</option><option value="es">Spanish</option></select></label>
            <label><span>FALLBACK DELAY</span><div className="badkb-number-field"><input type="number" min="0" max="10000" value={defaultDelay} onChange={(event) => setDefaultDelay(Math.max(0, Math.min(10_000, Number(event.target.value))))} /><small>MS</small></div></label>
            <p className="badkb-profile-note">Target and layout are written into the exported file as project metadata. Set the matching keyboard layout on your Flipper before running it.</p>
            {target === "ios" && (
              <div className="badkb-ios-setup">
                <Smartphone />
                <span><strong>iPhone / iPad ready</strong><small>Connect the Flipper with the correct USB-C cable or Lightning adapter. Command-Space actions use iOS Search. Turn on Full Keyboard Access only for broader keyboard navigation.</small></span>
              </div>
            )}
          </section>

          <section>
            <div className="badkb-section-heading"><span>STARTERS</span><strong>Safe templates</strong></div>
            <div className="badkb-templates">
              {templates.map((template) => (
                <button key={template.id} onClick={() => loadTemplate(template.name, template.script)}>
                  <span><strong>{template.name}</strong><small>{template.description}</small></span><ChevronRight />
                </button>
              ))}
            </div>
          </section>

          <section className="badkb-validation">
            <div className="badkb-section-heading"><span>VALIDATION</span><strong>{projectErrorCount ? `${projectErrorCount} blocked` : warningCount ? `${warningCount} to check` : "Ready to export"}</strong></div>
            {mode === "simple" && simpleErrorCount ? (
              <p className="badkb-block-validation"><AlertTriangle /> Fix the highlighted {simpleErrorCount === 1 ? "block" : "blocks"} before exporting.</p>
            ) : analysis.issues.length ? (
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
