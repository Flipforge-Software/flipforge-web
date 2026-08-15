import {
  ESPLoader,
  type FlashFreqValues,
  type FlashModeValues,
  type FlashSizeValues,
  type IEspLoaderTerminal,
  Transport,
} from "esptool-js";
import SparkMD5 from "spark-md5";
import type { FirmwareId, FirmwareTarget } from "./firmware";
import { firmwareUrl } from "./firmware";

const APP_PARTITION_ADDRESS = 0x10000;
const APP_IDENTITY_BYTES = 0x100;
const APP_DESCRIPTOR_OFFSET = 0x20;
const APP_DESCRIPTOR_MAGIC = 0xabcd5432;
const APP_VERSION_OFFSET = 0x30;
const APP_PROJECT_NAME_OFFSET = 0x50;
const APP_STRING_LENGTH = 32;

export interface FlashCallbacks {
  onProgress: (progress: number, detail: string) => void;
  onLog: (line: string) => void;
  onDeviceLost: () => void;
}

export interface FlashResult {
  chip: string;
  durationSeconds: number;
}

export interface FirmwareIdentity {
  id: FirmwareId | null;
  projectName: string;
  version: string;
}

export interface FirmwareDetectionResult extends FirmwareIdentity {
  chip: string;
}

export function supportsWebSerial(): boolean {
  return window.isSecureContext && "serial" in navigator;
}

async function sha256(data: Uint8Array): Promise<string> {
  const copy = new Uint8Array(data);
  const digest = await crypto.subtle.digest("SHA-256", copy.buffer);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function decodeCString(data: Uint8Array, offset: number, length: number): string {
  const bytes = data.slice(offset, offset + length);
  const end = bytes.indexOf(0);
  return new TextDecoder().decode(end >= 0 ? bytes.slice(0, end) : bytes).trim();
}

export function parseFirmwareIdentity(data: Uint8Array): FirmwareIdentity {
  if (data.byteLength < APP_PROJECT_NAME_OFFSET + APP_STRING_LENGTH) {
    return { id: null, projectName: "", version: "" };
  }

  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint32(APP_DESCRIPTOR_OFFSET, true) !== APP_DESCRIPTOR_MAGIC) {
    return { id: null, projectName: "", version: "" };
  }

  const projectName = decodeCString(data, APP_PROJECT_NAME_OFFSET, APP_STRING_LENGTH);
  const version = decodeCString(data, APP_VERSION_OFFSET, APP_STRING_LENGTH);
  const normalizedName = projectName.toLowerCase();
  const id = normalizedName === "flipforge_bridge" ? "bridge" : normalizedName === "blackmagic" ? "official" : null;

  return { id, projectName, version };
}

export async function resolveFirmwareIdentity(data: Uint8Array, targets: FirmwareTarget[]): Promise<FirmwareIdentity> {
  const parsed = parseFirmwareIdentity(data);
  if (parsed.id) return parsed;
  const fingerprint = await sha256(data);
  const target = targets.find((candidate) => candidate.appIdentitySha256 === fingerprint);
  return target
    ? { id: target.id, projectName: parsed.projectName, version: target.version }
    : parsed;
}

export async function detectFirmware(callbacks: FlashCallbacks, targets: FirmwareTarget[] = []): Promise<FirmwareDetectionResult> {
  if (!supportsWebSerial()) throw new Error("Use desktop Chrome or Edge over HTTPS to detect this board.");

  callbacks.onProgress(0.05, "Choose the ESP32-S2 serial port");
  const port = await navigator.serial.requestPort({ filters: [{ usbVendorId: 0x303a }] });
  const transport = new Transport(port, false);
  transport.setDeviceLostCallback(callbacks.onDeviceLost);
  let loader: ESPLoader | null = null;

  const terminal: IEspLoaderTerminal = {
    clean: () => undefined,
    write: callbacks.onLog,
    writeLine: callbacks.onLog,
  };

  try {
    loader = new ESPLoader({ transport, baudrate: 115200, terminal, debugLogging: false });
    callbacks.onProgress(0.2, "Connecting to the board");
    const chip = await loader.main("default_reset");
    if (!chip.toUpperCase().includes("ESP32-S2")) {
      throw new Error(`Unsupported chip detected: ${chip}. Only the official ESP32-S2 Wi-Fi Devboard is supported.`);
    }

    callbacks.onProgress(0.7, "Reading the installed firmware identity");
    const identityBytes = await loader.readFlash(APP_PARTITION_ADDRESS, APP_IDENTITY_BYTES);
    const identity = await resolveFirmwareIdentity(identityBytes, targets);
    callbacks.onProgress(1, identity.id ? "Firmware identified" : "Firmware is not recognized");
    return { ...identity, chip };
  } finally {
    if (loader) {
      try {
        await loader.after("hard_reset", true);
      } catch {
        // Native USB can disappear as the ESP32-S2 restarts its installed firmware.
      }
    }
    try {
      await transport.disconnect();
    } catch {
      // The board may already be gone after reset.
    }
  }
}

export async function fetchAndVerifySegments(target: FirmwareTarget, onProgress?: FlashCallbacks["onProgress"]) {
  const segments = [];
  for (let index = 0; index < target.segments.length; index += 1) {
    const segment = target.segments[index];
    onProgress?.((index / target.segments.length) * 0.08, `Verifying ${segment.name}`);
    const response = await fetch(firmwareUrl(segment.path), { cache: "no-cache" });
    if (!response.ok) throw new Error(`${segment.name} could not be downloaded.`);
    const data = new Uint8Array(await response.arrayBuffer());
    if (data.byteLength !== segment.size) throw new Error(`${segment.name} has an unexpected size.`);
    if ((await sha256(data)) !== segment.sha256) throw new Error(`${segment.name} failed SHA-256 verification.`);
    segments.push({ data, address: segment.address });
  }
  return segments;
}

export function aggregateProgress(
  fileIndex: number,
  written: number,
  fileTotal: number,
  segmentSizes: number[],
): number {
  const total = segmentSizes.reduce((sum, size) => sum + size, 0);
  if (total <= 0) return 0;
  const completed = segmentSizes.slice(0, fileIndex).reduce((sum, size) => sum + size, 0);
  const currentWeight = segmentSizes[fileIndex] ?? 0;
  const currentFraction = fileTotal > 0 ? Math.min(1, written / fileTotal) : 0;
  return Math.min(1, (completed + currentWeight * currentFraction) / total);
}

export async function flashFirmware(target: FirmwareTarget, callbacks: FlashCallbacks): Promise<FlashResult> {
  if (!supportsWebSerial()) throw new Error("Use desktop Chrome or Edge over HTTPS to flash this board.");
  const startedAt = performance.now();
  const files = await fetchAndVerifySegments(target, callbacks.onProgress);
  callbacks.onProgress(0.1, "Choose the ESP32-S2 serial port");

  const serial = navigator.serial;
  const port = await serial.requestPort({ filters: [{ usbVendorId: 0x303a }] });
  const transport = new Transport(port, false);
  transport.setDeviceLostCallback(callbacks.onDeviceLost);

  const terminal: IEspLoaderTerminal = {
    clean: () => undefined,
    write: callbacks.onLog,
    writeLine: callbacks.onLog,
  };

  try {
    const loader = new ESPLoader({ transport, baudrate: 115200, terminal, debugLogging: false });
    callbacks.onProgress(0.12, "Connecting to the board");
    const chip = await loader.main("default_reset");
    if (!chip.toUpperCase().includes("ESP32-S2")) {
      throw new Error(`Unsupported chip detected: ${chip}. Only the official ESP32-S2 Wi-Fi Devboard is supported.`);
    }

    const segmentSizes = target.segments.map((segment) => segment.size);
    callbacks.onProgress(0.15, `Connected to ${chip}`);
    if (target.eraseAll) callbacks.onLog("Performing the clean board erase required by the verified factory manifest.");
    await loader.writeFlash({
      fileArray: files,
      flashMode: target.flashMode as FlashModeValues,
      flashFreq: target.flashFrequency as FlashFreqValues,
      flashSize: target.flashSize as FlashSizeValues,
      eraseAll: target.eraseAll,
      compress: true,
      calculateMD5Hash: (image) =>
        SparkMD5.ArrayBuffer.hash(
          image.buffer.slice(image.byteOffset, image.byteOffset + image.byteLength) as ArrayBuffer,
        ),
      reportProgress: (fileIndex, written, total) => {
        const transfer = aggregateProgress(fileIndex, written, total, segmentSizes);
        callbacks.onProgress(0.15 + transfer * 0.83, `Writing ${target.segments[fileIndex]?.name ?? "firmware"}`);
      },
    });
    callbacks.onProgress(0.99, "Finalizing firmware");
    await loader.after("no_reset_stub");
    callbacks.onProgress(1, "Flash verified");
    return { chip, durationSeconds: (performance.now() - startedAt) / 1000 };
  } finally {
    try {
      await transport.disconnect();
    } catch {
      // Native USB can disappear as the ESP32-S2 leaves the bootloader.
    }
  }
}

export function flashErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === "NotFoundError") return "No port was selected.";
  if (error instanceof DOMException && error.name === "InvalidStateError") return "The serial port is already open in another app.";
  if (error instanceof DOMException && error.name === "NetworkError") return "The board disconnected. Re-enter bootloader mode and try again.";
  if (error instanceof Error) return error.message;
  return "The flash did not complete. Re-enter bootloader mode and try again.";
}
