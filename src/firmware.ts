export type FirmwareId = "bridge" | "official";

export interface FirmwareSegment {
  name: string;
  address: number;
  path: string;
  size: number;
  sha256: string;
}

export interface FirmwareTarget {
  id: FirmwareId;
  name: string;
  shortName: string;
  version: string;
  description: string;
  sourceName: string;
  sourceUrl: string;
  archiveSha256: string;
  chip: "ESP32-S2";
  flashMode: "dio";
  flashFrequency: "80m";
  flashSize: "4MB";
  segments: FirmwareSegment[];
}

export interface FirmwareCatalog {
  schemaVersion: 1;
  generatedAt: string;
  targets: FirmwareTarget[];
}

const expectedAddresses = new Set([0x1000, 0x8000, 0x10000]);

export function validateCatalog(value: unknown): FirmwareCatalog {
  if (!value || typeof value !== "object") throw new Error("Firmware catalog is missing.");
  const catalog = value as Partial<FirmwareCatalog>;
  if (catalog.schemaVersion !== 1 || !Array.isArray(catalog.targets)) {
    throw new Error("Firmware catalog is not supported.");
  }
  if (catalog.targets.length !== 2) throw new Error("Firmware catalog is incomplete.");

  const ids = new Set<FirmwareId>();
  for (const target of catalog.targets) {
    if (target.id !== "bridge" && target.id !== "official") throw new Error("Unknown firmware target.");
    if (ids.has(target.id)) throw new Error("Duplicate firmware target.");
    ids.add(target.id);
    if (target.chip !== "ESP32-S2" || target.flashMode !== "dio" || target.flashFrequency !== "80m" || target.flashSize !== "4MB") {
      throw new Error("Unsafe firmware parameters were rejected.");
    }
    if (!/^\d+(?:\.\d+){1,3}(?:[-+][0-9A-Za-z.-]+)?$/.test(target.version)) {
      throw new Error("Firmware version is invalid.");
    }
    if (!Array.isArray(target.segments) || target.segments.length !== 3) {
      throw new Error("Firmware image set is incomplete.");
    }
    const addresses = new Set(target.segments.map((segment) => segment.address));
    if (addresses.size !== 3 || [...addresses].some((address) => !expectedAddresses.has(address))) {
      throw new Error("Firmware offsets were rejected.");
    }
    for (const segment of target.segments) {
      if (!/^[a-f0-9]{64}$/.test(segment.sha256) || segment.size <= 0 || !segment.path.startsWith("firmware/")) {
        throw new Error("Firmware segment metadata is invalid.");
      }
    }
  }
  return catalog as FirmwareCatalog;
}

export async function loadFirmwareCatalog(): Promise<FirmwareCatalog> {
  const response = await fetch(`${import.meta.env.BASE_URL}firmware/manifest.json`, { cache: "no-cache" });
  if (!response.ok) throw new Error("Firmware catalog could not be loaded.");
  return validateCatalog(await response.json());
}

export function firmwareUrl(path: string): string {
  return `${import.meta.env.BASE_URL}${path}`;
}

export function formatBytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 * 1024) return `${(value / 1024).toFixed(0)} KB`;
  return `${(value / (1024 * 1024)).toFixed(1)} MB`;
}
