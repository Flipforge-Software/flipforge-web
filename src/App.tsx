import { useEffect, useMemo, useState } from "react";
import {
  ArrowRight,
  Check,
  CircleAlert,
  Copy,
  ExternalLink,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Terminal,
  Usb,
  Wifi,
} from "lucide-react";
import { BoardIllustration } from "./components/BoardIllustration";
import { flashErrorMessage, flashFirmware, supportsWebSerial } from "./flasher";
import {
  formatBytes,
  loadFirmwareCatalog,
  type FirmwareCatalog,
  type FirmwareId,
  type FirmwareTarget,
} from "./firmware";

type Phase = "prepare" | "flashing" | "complete" | "error";

const bootSteps = [
  "Remove the Wi-Fi Devboard from your Flipper.",
  "Connect the board directly to this computer with USB-C.",
  "Hold BOOT, tap RESET, then release BOOT.",
];

export default function App() {
  const [catalog, setCatalog] = useState<FirmwareCatalog | null>(null);
  const [selectedId, setSelectedId] = useState<FirmwareId>("bridge");
  const [phase, setPhase] = useState<Phase>("prepare");
  const [confirmed, setConfirmed] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressDetail, setProgressDetail] = useState("Waiting for your board");
  const [logs, setLogs] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const compatible = typeof window !== "undefined" && supportsWebSerial();

  useEffect(() => {
    loadFirmwareCatalog()
      .then((value) => {
        setCatalog(value);
        setLogs(["Verified firmware catalog loaded.", "Select a mode and prepare the ESP32-S2 board."]);
      })
      .catch((reason: unknown) => {
        const message = reason instanceof Error ? reason.message : "Firmware catalog could not be loaded.";
        setCatalogError(message);
        setLogs([`ERROR  ${message}`]);
      });
  }, []);

  const selected = useMemo(
    () => catalog?.targets.find((target) => target.id === selectedId) ?? null,
    [catalog, selectedId],
  );

  const totalSize = selected?.segments.reduce((sum, segment) => sum + segment.size, 0) ?? 0;
  const percent = Math.round(progress * 100);

  const chooseMode = (id: FirmwareId) => {
    if (phase === "flashing") return;
    const next = catalog?.targets.find((target) => target.id === id);
    setSelectedId(id);
    setPhase("prepare");
    setConfirmed(false);
    setProgress(0);
    setProgressDetail("Waiting for your board");
    setError(null);
    setLogs([
      `Mode set to ${next?.name ?? (id === "bridge" ? "Flipforge Bridge" : "Original Flipper Firmware")}.`,
      "Complete the bootloader steps, then connect the serial port.",
    ]);
  };

  const appendLog = (line: string) => {
    const clean = line.trim();
    if (!clean) return;
    setLogs((current) => [...current.slice(-119), clean]);
  };

  const startFlash = async () => {
    if (!selected || !confirmed || !compatible) return;
    setPhase("flashing");
    setProgress(0);
    setError(null);
    setLogs([`Preparing ${selected.name} ${selected.version}.`, "Downloading verified firmware images…"]);

    try {
      const result = await flashFirmware(selected, {
        onProgress: (value, detail) => {
          setProgress(value);
          setProgressDetail(detail);
        },
        onLog: appendLog,
        onDeviceLost: () => appendLog("Serial device disconnected."),
      });
      setProgress(1);
      setProgressDetail("Flash verified");
      appendLog(`${selected.shortName} ${selected.version} verified on ${result.chip}.`);
      appendLog("Press RESET on the board to start the new firmware.");
      setPhase("complete");
    } catch (reason) {
      const message = flashErrorMessage(reason);
      setError(message);
      appendLog(`ERROR  ${message}`);
      setPhase("error");
    }
  };

  const resetWorkflow = () => {
    setPhase("prepare");
    setConfirmed(false);
    setProgress(0);
    setProgressDetail("Waiting for your board");
    setError(null);
    setLogs(["Ready for another board."]);
  };

  const copyLink = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  const stateLabel =
    phase === "flashing"
      ? "Writing firmware"
      : phase === "complete"
        ? "Complete"
        : phase === "error"
          ? "Stopped"
          : catalogError
            ? "Catalog error"
            : "Ready";

  return (
    <main className="app" id="top">
      <header className="topbar">
        <a className="wordmark" href="#top" aria-label="Flipforge home">
          <span className="wordmark-mark">FF</span>
          <span>FLIPFORGE</span>
        </a>
        <div className="topbar-status">
          <span className={`status-dot ${compatible ? "ready" : ""}`} />
          {compatible ? "WEB SERIAL READY" : "COMPUTER BROWSER REQUIRED"}
        </div>
        <a className="source-link" href="https://github.com/Flipforge-Software/flipforge-web" target="_blank" rel="noreferrer">
          SOURCE <ExternalLink />
        </a>
      </header>

      <div className="workspace">
        <section className="workspace-intro">
          <div>
            <p className="eyebrow">WI-FI DEVBOARD UTILITY</p>
            <h1>Flash or restore your board.</h1>
            <p>Install the Flipforge mobile bridge or return to the original Flipper firmware.</p>
          </div>
          <div className="intro-board" aria-hidden="true">
            <BoardIllustration active={phase === "flashing"} />
          </div>
        </section>

        <div className="utility-grid">
          <section className="setup-pane" aria-labelledby="setup-title">
            <div className="pane-heading">
              <span>SETUP</span>
              <h2 id="setup-title">Choose firmware</h2>
            </div>

            <div className="mode-switch" aria-label="Firmware mode">
              <ModeButton
                target={catalog?.targets.find((target) => target.id === "bridge")}
                selected={selectedId === "bridge"}
                icon={<Wifi />}
                fallbackName="Flipforge Bridge"
                onClick={() => chooseMode("bridge")}
                disabled={phase === "flashing"}
              />
              <ModeButton
                target={catalog?.targets.find((target) => target.id === "official")}
                selected={selectedId === "official"}
                icon={<RotateCcw />}
                fallbackName="Original Firmware"
                onClick={() => chooseMode("official")}
                disabled={phase === "flashing"}
              />
            </div>

            <div className="firmware-meta">
              <span><b>VERSION</b>{selected ? selected.version : "—"}</span>
              <span><b>DOWNLOAD</b>{selected ? formatBytes(totalSize) : "—"}</span>
              <span><b>CHIP</b>ESP32-S2</span>
              <span><b>SOURCE</b>{selected?.sourceName ?? "—"}</span>
            </div>

            <div className="step-block">
              <div className="block-label"><Usb /> CONNECT THE BOARD</div>
              <ol className="boot-steps">
                {bootSteps.map((step, index) => (
                  <li key={step}>
                    <span>{index + 1}</span>
                    <p>{step}</p>
                  </li>
                ))}
              </ol>
            </div>

            {phase === "complete" && (
              <div className="result-message success" role="status">
                <Check />
                <div><strong>Firmware verified.</strong><span>Press RESET on the board to start it.</span></div>
              </div>
            )}

            {phase === "error" && (
              <div className="result-message error" role="alert">
                <CircleAlert />
                <div><strong>Flash stopped.</strong><span>{error}</span></div>
              </div>
            )}

            {!compatible ? (
              <div className="browser-handoff">
                <strong>Open this page in desktop Chrome or Edge.</strong>
                <span>iPhone and iPad do not expose the serial connection used by the board bootloader.</span>
                <button onClick={copyLink}>{copied ? <Check /> : <Copy />}{copied ? "Link copied" : "Copy link"}</button>
              </div>
            ) : phase === "complete" || phase === "error" ? (
              <button className="secondary-action" onClick={resetWorkflow}><RefreshCw /> Start again</button>
            ) : (
              <>
                <label className="confirmation">
                  <input
                    type="checkbox"
                    checked={confirmed}
                    onChange={(event) => setConfirmed(event.target.checked)}
                    disabled={phase === "flashing"}
                  />
                  <span className="check-box"><Check /></span>
                  <span>I completed all three steps</span>
                </label>
                <button className="primary-action" onClick={startFlash} disabled={!selected || !confirmed || phase === "flashing" || Boolean(catalogError)}>
                  {phase === "flashing" ? "Flashing…" : `Connect & flash ${selected?.shortName ?? "firmware"}`}
                  <ArrowRight />
                </button>
                <p className="action-note"><ShieldCheck /> Firmware is verified before anything is written.</p>
              </>
            )}
          </section>

          <ConsolePane
            state={stateLabel}
            phase={phase}
            percent={percent}
            detail={progressDetail}
            logs={logs}
            catalogError={catalogError}
          />
        </div>

        <footer>
          <span><ShieldCheck /> LOCAL USB FLASHING</span>
          <p>No firmware or serial data is uploaded to Flipforge.</p>
          <p>Use only with the official ESP32-S2 Wi-Fi Devboard.</p>
        </footer>
      </div>
    </main>
  );
}

function ModeButton({
  target,
  selected,
  icon,
  fallbackName,
  onClick,
  disabled,
}: {
  target?: FirmwareTarget;
  selected: boolean;
  icon: React.ReactNode;
  fallbackName: string;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <button className={`mode-button ${selected ? "selected" : ""}`} aria-pressed={selected} onClick={onClick} disabled={disabled || !target}>
      <span className="mode-icon">{icon}</span>
      <span><strong>{target?.name ?? fallbackName}</strong><small>{target?.description ?? "Loading verified release…"}</small></span>
      <span className="mode-version">{target ? `v${target.version}` : "—"}</span>
    </button>
  );
}

function ConsolePane({
  state,
  phase,
  percent,
  detail,
  logs,
  catalogError,
}: {
  state: string;
  phase: Phase;
  percent: number;
  detail: string;
  logs: string[];
  catalogError: string | null;
}) {
  const visibleLogs = logs.length ? logs.slice(-14) : ["Loading verified firmware catalog…"];
  const stateClass = phase === "complete" ? "success" : phase === "error" || catalogError ? "error" : phase === "flashing" ? "active" : "";

  return (
    <section className="console-pane" aria-label="Flash console" aria-live="polite">
      <div className="console-head">
        <span><Terminal /> FLASH CONSOLE</span>
        <span className={`console-state ${stateClass}`}><i />{state}</span>
      </div>
      <div className="progress-summary">
        <div className="percent"><strong>{percent}</strong><span>%</span></div>
        <div><small>CURRENT STEP</small><strong>{catalogError ?? detail}</strong></div>
      </div>
      <div className="progress-track" aria-label={`${percent}% complete`}>
        <span style={{ width: `${percent}%` }} />
      </div>
      <div className="terminal-log">
        {visibleLogs.map((line, index) => (
          <code key={`${index}-${line}`}><span>›</span>{line}</code>
        ))}
        {phase === "flashing" && <span className="console-cursor" />}
      </div>
      <div className="console-foot">
        <span>USB / LOCAL</span>
        <span>SHA-256 VERIFIED</span>
      </div>
    </section>
  );
}
