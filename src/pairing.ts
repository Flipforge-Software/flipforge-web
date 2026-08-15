const PAIRING_PREFIX = "FFPAIR1";
const PAIRING_TIMEOUT_MS = 12_000;
const MAX_CONSOLE_CHARACTERS = 16 * 1_024;

export interface BridgePairingCredential {
  pairingLine: string;
  ssid: string;
  wifiPassword: string;
  pairingSecret: string;
}

export interface PairingCallbacks {
  onProgress: (progress: number, detail: string) => void;
  onDeviceLost: () => void;
}

export interface PairingOptions {
  port?: SerialPort;
}

export function isPotentialBridgePort(info: SerialPortInfo): boolean {
  return info.usbVendorId === 0x303a;
}

export async function findAuthorizedBridgePorts(): Promise<SerialPort[]> {
  if (!window.isSecureContext || !("serial" in navigator)) return [];
  const ports = await navigator.serial.getPorts();
  return ports.filter((port) => isPotentialBridgePort(port.getInfo()));
}

function isPrintableASCII(value: string): boolean {
  return value.length >= 8 && value.length <= 63 && /^[\x20-\x7e]+$/.test(value);
}

export function parseBridgePairingResponse(input: string): BridgePairingCredential {
  const candidates = input
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.startsWith(PAIRING_PREFIX));
  const line = candidates.at(-1);
  if (!line) throw new Error("The Bridge did not return a pairing credential.");

  const fields = line.split(/\s+/);
  if (fields.length !== 4 || fields[0] !== PAIRING_PREFIX) {
    throw new Error("The Bridge returned an incomplete pairing credential.");
  }

  const [, ssid, wifiPassword, pairingSecret] = fields;
  const hasControlCharacter = [...ssid].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
  if (!ssid.startsWith("Flipforge-") || ssid.length > 32 || hasControlCharacter) {
    throw new Error("The Bridge returned an invalid Wi-Fi name.");
  }
  if (!isPrintableASCII(wifiPassword)) {
    throw new Error("The Bridge returned an invalid Wi-Fi password.");
  }
  if (!/^[a-fA-F0-9]{64}$/.test(pairingSecret)) {
    throw new Error("The Bridge returned an invalid authentication secret.");
  }

  const normalizedSecret = pairingSecret.toLowerCase();
  return {
    pairingLine: `${PAIRING_PREFIX} ${ssid} ${wifiPassword} ${normalizedSecret}`,
    ssid,
    wifiPassword,
    pairingSecret: normalizedSecret,
  };
}

function hasCompletePairingLine(input: string): boolean {
  const completeLines = input.split(/\r?\n/).slice(0, -1);
  return completeLines.some((line) => line.trim().startsWith(PAIRING_PREFIX));
}

function readWithTimeout(
  reader: ReadableStreamDefaultReader<Uint8Array>,
  timeoutMs: number,
): Promise<ReadableStreamReadResult<Uint8Array>> {
  return new Promise((resolve, reject) => {
    const timer = window.setTimeout(() => reject(new Error("Timed out waiting for physical confirmation.")), timeoutMs);
    reader.read().then(
      (result) => {
        window.clearTimeout(timer);
        resolve(result);
      },
      (error: unknown) => {
        window.clearTimeout(timer);
        reject(error);
      },
    );
  });
}

export async function retrieveBridgePairing(
  callbacks: PairingCallbacks,
  options: PairingOptions = {},
): Promise<BridgePairingCredential> {
  if (!window.isSecureContext || !("serial" in navigator)) {
    throw new Error("Use desktop Chrome or Edge over HTTPS to retrieve Bridge auth.");
  }

  callbacks.onProgress(
    0.05,
    options.port ? "Using the detected USB board" : "Choose your running Flipforge Bridge",
  );
  const port = options.port ?? await navigator.serial.requestPort({ filters: [{ usbVendorId: 0x303a }] });
  const onDisconnect = () => callbacks.onDeviceLost();
  port.addEventListener("disconnect", onDisconnect);
  let reader: ReadableStreamDefaultReader<Uint8Array> | null = null;

  try {
    await port.open({ baudRate: 115200, bufferSize: 1_024 });
    if (!port.readable || !port.writable) throw new Error("The selected port is not the running Flipforge Bridge.");

    callbacks.onProgress(0.3, "Requesting the protected pairing credential");
    const writer = port.writable.getWriter();
    try {
      await writer.write(new TextEncoder().encode("PAIR\n"));
    } finally {
      writer.releaseLock();
    }

    callbacks.onProgress(0.5, "Keep holding BOOT while the Bridge responds");
    reader = port.readable.getReader();
    const decoder = new TextDecoder();
    const deadline = Date.now() + PAIRING_TIMEOUT_MS;
    let response = "";

    while (Date.now() < deadline) {
      const result = await readWithTimeout(reader, Math.max(1, deadline - Date.now()));
      if (result.done) break;
      if (!result.value?.byteLength) continue;
      response += decoder.decode(result.value, { stream: true });
      if (response.length > MAX_CONSOLE_CHARACTERS) response = response.slice(-MAX_CONSOLE_CHARACTERS);
      if (hasCompletePairingLine(response)) {
        const credential = parseBridgePairingResponse(response);
        callbacks.onProgress(1, "Bridge auth received securely");
        return credential;
      }
    }

    throw new Error("No credential received. Hold BOOT for two seconds, keep holding it, and try again.");
  } finally {
    if (reader) {
      try {
        await reader.cancel();
      } catch {
        // The runtime port may disappear if the board resets.
      }
      reader.releaseLock();
    }
    port.removeEventListener("disconnect", onDisconnect);
    try {
      await port.close();
    } catch {
      // Closing an already-disconnected runtime port is harmless.
    }
  }
}

export function pairingErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotFoundError") return "No port was selected.";
  if (error instanceof DOMException && error.name === "InvalidStateError") return "The serial port is already open in another app.";
  if (error instanceof DOMException && error.name === "NetworkError") return "The Bridge disconnected. Reset it and try again.";
  if (error instanceof Error) return error.message;
  return "Bridge auth could not be retrieved. Reset the board and try again.";
}
