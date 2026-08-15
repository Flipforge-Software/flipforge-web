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
  Zap,
} from "lucide-react";
import { flashErrorMessage, flashFirmware, supportsWebSerial } from "./flasher";
import {
  formatBytes,
  loadFirmwareCatalog,
  type FirmwareCatalog,
  type FirmwareId,
  type FirmwareTarget,
} from "./firmware";

type Phase = "prepare" | "flashing" | "complete" | "error";
type SiteTab = "home" | "flash";

const bootSteps = [
  "Remove the Wi-Fi Devboard from your Flipper.",
  "Connect the board directly to this computer with USB-C.",
  "Hold BOOT, tap RESET, then release BOOT.",
];

function tabFromPath(): SiteTab {
  return window.location.pathname.startsWith("/flash") ? "flash" : "home";
}

export default function App() {
  const [tab, setTab] = useState<SiteTab>(tabFromPath);
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
    const updateTab = () => setTab(tabFromPath());
    window.addEventListener("popstate", updateTab);
    return () => window.removeEventListener("popstate", updateTab);
  }, []);

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

  const navigate = (nextTab: SiteTab) => {
    const path = nextTab === "flash" ? "/flash" : "/";
    if (window.location.pathname !== path) window.history.pushState({}, "", path);
    setTab(nextTab);
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

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
    <div className={`site site-${tab}`}>
      <SiteHeader tab={tab} compatible={compatible} onNavigate={navigate} />

      {tab === "home" ? (
        <HomePage onOpenFlash={() => navigate("flash")} />
      ) : (
        <main className="flash-page">
          <section className="flash-intro">
            <p className="eyebrow">DEVBOARD UTILITY</p>
            <h1>Flash your Wi-Fi Devboard.</h1>
            <p>Install the mobile bridge or restore the original Flipper firmware.</p>
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
        </main>
      )}

      <SiteFooter />
    </div>
  );
}

function SiteHeader({ tab, compatible, onNavigate }: { tab: SiteTab; compatible: boolean; onNavigate: (tab: SiteTab) => void }) {
  const link = (target: SiteTab, label: string) => (
    <a
      href={target === "home" ? "/" : "/flash"}
      className={tab === target ? "active" : ""}
      aria-current={tab === target ? "page" : undefined}
      onClick={(event) => { event.preventDefault(); onNavigate(target); }}
    >
      {label}
    </a>
  );

  return (
    <header className="topbar">
      <a className="wordmark" href="/" onClick={(event) => { event.preventDefault(); onNavigate("home"); }} aria-label="Flipforge home">
        <span className="wordmark-mark">FF</span>
        <span>FLIPFORGE</span>
      </a>
      <nav aria-label="Primary navigation">
        {link("home", "HOME")}
        {link("flash", "FLASH")}
      </nav>
      <div className="topbar-status">
        <span className={`status-dot ${compatible ? "ready" : ""}`} />
        {compatible ? "SERIAL READY" : "DESKTOP REQUIRED"}
      </div>
    </header>
  );
}

function HomePage({ onOpenFlash }: { onOpenFlash: () => void }) {
  return (
    <main className="home-page">
      <section className="home-hero">
        <div className="hero-copy">
          <p className="lcd-kicker">FLIPPER ZERO / WI-FI DEVBOARD</p>
          <h1>FLIPFORGE</h1>
          <p>A private local bridge between your Flipper and iPhone. Fast when you need it, reversible when you do not.</p>
          <div className="hero-actions">
            <button className="hero-primary" onClick={onOpenFlash}>INSTALL BRIDGE <ArrowRight /></button>
            <a href="#how">HOW IT WORKS</a>
          </div>
        </div>
        <div className="device-stage">
          <span className="device-halo" aria-hidden="true" />
          <img src="/assets/flipper-device.png" alt="Flipper Zero running the Flipforge bridge" />
          <span className="device-signal" aria-hidden="true"><i /><i /><i /></span>
        </div>
      </section>

      <section className="home-proof" id="how">
        <div className="proof-heading">
          <p className="eyebrow">HOW IT WORKS</p>
          <h2>One board.<br />Two clean modes.</h2>
          <p className="proof-summary">Install Flipforge Bridge for the mobile app, then return to the original firmware whenever you want.</p>
        </div>
        <div className="proof-steps">
          <article><span>01</span><Wifi /><h3>Install in browser</h3><p>Connect the Wi-Fi Devboard by USB and flash it directly from Chrome or Edge.</p></article>
          <article><span>02</span><Zap /><h3>Connect locally</h3><p>Pair Flipforge over the board’s private Wi-Fi link. No cloud relay is involved.</p></article>
          <article><span>03</span><RotateCcw /><h3>Restore anytime</h3><p>Use the same flasher to return to Flipper’s original Blackmagic firmware.</p></article>
        </div>
      </section>

      <section className="home-modes" aria-labelledby="modes-title">
        <div className="modes-heading">
          <p className="eyebrow">REVERSIBLE BY DESIGN</p>
          <h2 id="modes-title">Bridge in.<br />Flash back.</h2>
        </div>
        <div className="mode-lines">
          <article>
            <span>BRIDGE MODE</span>
            <h3>Built for Flipforge</h3>
            <p>Local Wi-Fi connectivity and faster transfers between the Devboard and mobile app.</p>
            <Wifi />
          </article>
          <article>
            <span>ORIGINAL MODE</span>
            <h3>Built for Flipper</h3>
            <p>Restore the official board firmware when you want its original debugging workflow back.</p>
            <RotateCcw />
          </article>
        </div>
      </section>

      <section className="home-cta">
        <div>
          <p className="eyebrow">ESP32-S2 / USB</p>
          <h2>Start with your Devboard.</h2>
        </div>
        <button onClick={onOpenFlash}>OPEN FLASHER <ArrowRight /></button>
      </section>
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

function SiteFooter() {
  return (
    <footer className="site-footer">
      <span><ShieldCheck /> LOCAL-FIRST</span>
      <p>No firmware or serial data is uploaded to Flipforge.</p>
      <a href="https://github.com/Flipforge-Software/flipforge-web" target="_blank" rel="noreferrer">SOURCE <ExternalLink /></a>
    </footer>
  );
}
