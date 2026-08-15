import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, ChevronRight, CircleAlert, Copy, ExternalLink, RotateCcw, ShieldCheck, Usb, Wifi } from "lucide-react";
import { BoardIllustration } from "./components/BoardIllustration";
import { flashErrorMessage, flashFirmware, supportsWebSerial } from "./flasher";
import { formatBytes, loadFirmwareCatalog, type FirmwareCatalog, type FirmwareId, type FirmwareTarget } from "./firmware";

type Phase = "select" | "prepare" | "flashing" | "complete" | "error";

const bootSteps = [
  "Remove the Wi-Fi Devboard from your Flipper.",
  "Connect the board directly to this computer with USB-C.",
  "Hold BOOT, press and release RESET, then release BOOT.",
];

export default function App() {
  const [catalog, setCatalog] = useState<FirmwareCatalog | null>(null);
  const [selectedId, setSelectedId] = useState<FirmwareId>("bridge");
  const [phase, setPhase] = useState<Phase>("select");
  const [confirmed, setConfirmed] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressDetail, setProgressDetail] = useState("Waiting for board");
  const [error, setError] = useState<string | null>(null);
  const [resultText, setResultText] = useState("");
  const [logs, setLogs] = useState<string[]>([]);
  const [catalogError, setCatalogError] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const workflowRef = useRef<HTMLElement>(null);
  const compatible = typeof window !== "undefined" && supportsWebSerial();

  useEffect(() => {
    loadFirmwareCatalog().then(setCatalog).catch((reason: unknown) => {
      setCatalogError(reason instanceof Error ? reason.message : "Firmware catalog could not be loaded.");
    });
  }, []);

  const selected = useMemo(
    () => catalog?.targets.find((target) => target.id === selectedId) ?? null,
    [catalog, selectedId],
  );

  const chooseMode = (id: FirmwareId) => {
    if (phase === "flashing") return;
    setSelectedId(id);
    setPhase("prepare");
    setConfirmed(false);
    setError(null);
    requestAnimationFrame(() => workflowRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }));
  };

  const startFlash = async () => {
    if (!selected || !confirmed || !compatible) return;
    setPhase("flashing");
    setProgress(0);
    setLogs([]);
    setError(null);
    try {
      const result = await flashFirmware(selected, {
        onProgress: (value, detail) => {
          setProgress(value);
          setProgressDetail(detail);
        },
        onLog: (line) => setLogs((current) => [...current.slice(-79), line.trim()].filter(Boolean)),
        onDeviceLost: () => setLogs((current) => [...current.slice(-79), "Serial device disconnected."]),
      });
      setResultText(`${selected.shortName} ${selected.version} was verified on ${result.chip} in ${result.durationSeconds.toFixed(0)} seconds.`);
      setPhase("complete");
    } catch (reason) {
      setError(flashErrorMessage(reason));
      setPhase("error");
    }
  };

  const resetWorkflow = () => {
    setPhase("prepare");
    setConfirmed(false);
    setProgress(0);
    setError(null);
    setLogs([]);
  };

  const copyLink = async () => {
    await navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  };

  return (
    <main>
      <header className="site-header">
        <a className="wordmark" href="#top" aria-label="Flipforge home">
          <span className="wordmark-mark">FF</span>
          <span>FLIPFORGE</span>
        </a>
        <div className="header-meta"><span className={`status-dot ${compatible ? "ready" : ""}`} /> DEVBOARD UTILITY</div>
      </header>

      <section className="hero" id="top">
        <div className="hero-copy">
          <p className="eyebrow">OFFICIAL ESP32-S2 WI-FI DEVBOARD</p>
          <h1>Flash it for Flipforge.<br /><span>Restore it anytime.</span></h1>
          <p className="hero-support">One guided tool to install the mobile bridge or return your board to Flipper’s original firmware.</p>
        </div>
        <BoardIllustration active={phase === "flashing"} />
        <div className="hero-floor">
          <span>{compatible ? "Browser ready" : "Desktop Chrome or Edge required"}</span>
          <span>USB · LOCAL · VERIFIED</span>
        </div>
      </section>

      <section className="mode-section" aria-labelledby="choose-title">
        <div className="section-index">01</div>
        <div className="section-heading">
          <p className="eyebrow">CHOOSE A PATH</p>
          <h2 id="choose-title">What should this board run?</h2>
        </div>
        <div className="mode-list">
          <ModeRow
            target={catalog?.targets.find((target) => target.id === "bridge")}
            icon={<Wifi />}
            selected={selectedId === "bridge"}
            action="Install Bridge"
            onClick={() => chooseMode("bridge")}
          />
          <ModeRow
            target={catalog?.targets.find((target) => target.id === "official")}
            icon={<RotateCcw />}
            selected={selectedId === "official"}
            action="Restore Original"
            onClick={() => chooseMode("official")}
          />
        </div>
        {catalogError && <div className="inline-error"><CircleAlert /> {catalogError}</div>}
      </section>

      <section className="workflow" ref={workflowRef} aria-labelledby="workflow-title">
        <div className="workflow-head">
          <div className="section-index">02</div>
          <div className="section-heading">
            <p className="eyebrow">GUIDED FLASH</p>
            <h2 id="workflow-title">{selected ? selected.name : "Select firmware above"}</h2>
          </div>
          {selected && <div className="version-lock"><ShieldCheck /> VERIFIED BUILD <strong>{selected.version}</strong></div>}
        </div>

        {!compatible ? (
          <MobileHandoff onCopy={copyLink} copied={copied} />
        ) : phase === "flashing" ? (
          <FlashProgress progress={progress} detail={progressDetail} logs={logs} />
        ) : phase === "complete" ? (
          <Completion selected={selected!} detail={resultText} onAgain={resetWorkflow} />
        ) : phase === "error" ? (
          <ErrorState message={error!} logs={logs} onRetry={resetWorkflow} />
        ) : (
          <Preparation
            selected={selected}
            confirmed={confirmed}
            onConfirmed={setConfirmed}
            onFlash={startFlash}
            loading={!catalog && !catalogError}
          />
        )}
      </section>

      <section className="safety-strip">
        <ShieldCheck />
        <div><strong>Nothing is uploaded.</strong><span>Firmware travels from this page directly to your board over USB. Flipforge does not receive serial data.</span></div>
        <a href="https://github.com/Flipforge-Software/flipforge-web" target="_blank" rel="noreferrer">View source <ExternalLink /></a>
      </section>

      <footer><span>FLIPFORGE SOFTWARE</span><span>Use only with the official ESP32-S2 Wi-Fi Devboard.</span></footer>
    </main>
  );
}

function ModeRow({ target, icon, selected, action, onClick }: { target?: FirmwareTarget; icon: React.ReactNode; selected: boolean; action: string; onClick: () => void }) {
  const total = target?.segments.reduce((sum, segment) => sum + segment.size, 0);
  return (
    <button className={`mode-row ${selected ? "selected" : ""}`} onClick={onClick} disabled={!target}>
      <span className="mode-icon">{icon}</span>
      <span className="mode-copy"><strong>{target?.name ?? "Loading firmware…"}</strong><small>{target?.description ?? "Checking verified release"}</small></span>
      <span className="mode-facts">{target && <><b>v{target.version}</b><small>{formatBytes(total ?? 0)}</small></>}</span>
      <span className="mode-action">{action} <ChevronRight /></span>
    </button>
  );
}

function Preparation({ selected, confirmed, onConfirmed, onFlash, loading }: { selected: FirmwareTarget | null; confirmed: boolean; onConfirmed: (value: boolean) => void; onFlash: () => void; loading: boolean }) {
  return (
    <div className="preparation-grid">
      <ol className="boot-steps">
        {bootSteps.map((step, index) => <li key={step}><span>{String(index + 1).padStart(2, "0")}</span><p>{step}</p></li>)}
      </ol>
      <div className="flash-control">
        <Usb className="control-icon" />
        <p className="eyebrow">BOOTLOADER CHECK</p>
        <h3>Ready for the port picker?</h3>
        <p>The browser should show a device labeled ESP32-S2 or USB JTAG/serial.</p>
        <label className="confirmation">
          <input type="checkbox" checked={confirmed} onChange={(event) => onConfirmed(event.target.checked)} />
          <span className="check-box"><Check /></span>
          <span>I completed the three steps</span>
        </label>
        <button className="primary-action" onClick={onFlash} disabled={!selected || !confirmed || loading}>
          {loading ? "Loading verified firmware" : `Connect & flash ${selected?.shortName ?? "firmware"}`} <ArrowRight />
        </button>
        <small className="control-note">Do not unplug the board while writing.</small>
      </div>
    </div>
  );
}

function FlashProgress({ progress, detail, logs }: { progress: number; detail: string; logs: string[] }) {
  const percent = Math.round(progress * 100);
  return (
    <div className="progress-layout" aria-live="polite">
      <div className="progress-number"><strong>{percent}</strong><span>%</span></div>
      <div className="progress-copy"><p className="eyebrow">BOARD CONNECTED</p><h3>{detail}</h3><div className="progress-track"><span style={{ width: `${percent}%` }} /></div><p>Keep this tab open and leave the USB cable connected.</p></div>
      <div className="terminal" aria-label="Flash log">{logs.length ? logs.slice(-8).map((line, index) => <code key={`${index}-${line}`}>{line}</code>) : <code>Starting secure local flash…</code>}</div>
    </div>
  );
}

function Completion({ selected, detail, onAgain }: { selected: FirmwareTarget; detail: string; onAgain: () => void }) {
  return (
    <div className="completion-state">
      <span className="success-mark"><Check /></span>
      <div><p className="eyebrow">FLASH VERIFIED</p><h3>Press RESET on the board.</h3><p>{detail}</p><p className="next-step">{selected.id === "bridge" ? "Then attach it to your Flipper and open Flipforge to connect over Wi-Fi." : "The original Flipper Devboard functionality will start after RESET."}</p></div>
      <button className="secondary-action" onClick={onAgain}>Flash again</button>
    </div>
  );
}

function ErrorState({ message, logs, onRetry }: { message: string; logs: string[]; onRetry: () => void }) {
  return (
    <div className="error-state">
      <CircleAlert />
      <div><p className="eyebrow">FLASH STOPPED</p><h3>{message}</h3><p>No success was reported. Put the board back in bootloader mode before retrying.</p></div>
      <button className="secondary-action" onClick={onRetry}>Try again</button>
      {logs.length > 0 && <div className="terminal">{logs.slice(-6).map((line, index) => <code key={`${index}-${line}`}>{line}</code>)}</div>}
    </div>
  );
}

function MobileHandoff({ onCopy, copied }: { onCopy: () => void; copied: boolean }) {
  return (
    <div className="handoff-state">
      <span className="handoff-device"><Usb /></span>
      <div><p className="eyebrow">COMPUTER REQUIRED</p><h3>Open this page in Chrome or Edge on a Mac, Windows PC, Linux computer, or supported Android device.</h3><p>iPhone and iPad browsers do not expose the Web Serial connection needed by the ESP32-S2 bootloader.</p></div>
      <button className="secondary-action" onClick={onCopy}>{copied ? <Check /> : <Copy />}{copied ? "Link copied" : "Copy this link"}</button>
    </div>
  );
}
