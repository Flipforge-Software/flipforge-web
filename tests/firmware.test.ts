import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { aggregateProgress, parseFirmwareIdentity, resolveFirmwareIdentity } from "../src/flasher";
import { validateCatalog, type FirmwareCatalog, type FirmwareId } from "../src/firmware";

const hash = "a".repeat(64);
const target = (id: FirmwareId) => ({
  id,
  name: id,
  shortName: id,
  version: "1.2.3",
  description: "Test firmware",
  sourceName: "Test",
  sourceUrl: "https://example.com",
  archiveSha256: hash,
  appIdentitySha256: hash,
  eraseAll: id === "marauder",
  chip: "ESP32-S2" as const,
  flashMode: "dio" as const,
  flashFrequency: "80m" as const,
  flashSize: "4MB" as const,
  segments: [
    { name: "Bootloader", address: 0x1000, path: `firmware/${id}/boot.bin`, size: 10, sha256: hash },
    { name: "Partition", address: 0x8000, path: `firmware/${id}/part.bin`, size: 20, sha256: hash },
    ...(id === "marauder" ? [{ name: "OTA data", address: 0xe000, path: `firmware/${id}/ota.bin`, size: 8, sha256: hash }] : []),
    { name: "App", address: 0x10000, path: `firmware/${id}/app.bin`, size: 70, sha256: hash },
  ].map((segment) => ({ ...segment, path: `firmware/${id}/1.2.3/${segment.path.split("/").at(-1)}` })),
});

const catalog: FirmwareCatalog = {
  schemaVersion: 2,
  generatedAt: "2026-08-15T00:00:00Z",
  targets: [target("bridge"), target("marauder"), target("official")],
};

describe("firmware catalog", () => {
  it("accepts the three known ESP32-S2 targets", () => {
    expect(validateCatalog(catalog)).toEqual(catalog);
  });

  it("rejects an unexpected flash offset", () => {
    const malformed = structuredClone(catalog);
    malformed.targets[0].segments[2].address = 0x20000;
    expect(() => validateCatalog(malformed)).toThrow("offsets");
  });

  it("rejects an unknown target", () => {
    const malformed = structuredClone(catalog) as unknown as { targets: { id: string }[] };
    malformed.targets[0].id = "custom";
    expect(() => validateCatalog(malformed)).toThrow("Unknown firmware");
  });

  it("requires a clean erase only for Marauder", () => {
    const malformed = structuredClone(catalog);
    malformed.targets.find((candidate) => candidate.id === "marauder")!.eraseAll = false;
    expect(() => validateCatalog(malformed)).toThrow("erase policy");
  });
});

describe("flash progress", () => {
  it("weights progress by segment size", () => {
    expect(aggregateProgress(0, 5, 10, [10, 20, 70])).toBeCloseTo(0.05);
    expect(aggregateProgress(1, 10, 20, [10, 20, 70])).toBeCloseTo(0.2);
    expect(aggregateProgress(2, 70, 70, [10, 20, 70])).toBe(1);
  });
});

function appIdentity(projectName: string, version: string, validMagic = true): Uint8Array {
  const data = new Uint8Array(0x100);
  const view = new DataView(data.buffer);
  view.setUint32(0x20, validMagic ? 0xabcd5432 : 0, true);
  data.set(new TextEncoder().encode(version).slice(0, 31), 0x30);
  data.set(new TextEncoder().encode(projectName).slice(0, 31), 0x50);
  return data;
}

describe("firmware identity detector", () => {
  it("recognizes the actual packaged Forge, Marauder, and stock images", async () => {
    const packagedCatalog = JSON.parse(readFileSync(new URL("../public/firmware/manifest.json", import.meta.url), "utf8")) as FirmwareCatalog;
    const appBytes = (id: FirmwareId) => {
      const packagedTarget = packagedCatalog.targets.find((candidate) => candidate.id === id)!;
      const app = packagedTarget.segments.find((segment) => segment.address === 0x10000)!;
      return readFileSync(new URL(`../public/${app.path}`, import.meta.url)).subarray(0, 0x100);
    };

    expect(parseFirmwareIdentity(appBytes("bridge"))).toMatchObject({ id: "bridge", projectName: "flipforge_bridge" });
    expect(await resolveFirmwareIdentity(appBytes("marauder"), packagedCatalog.targets)).toMatchObject({ id: "marauder", version: packagedCatalog.targets.find((candidate) => candidate.id === "marauder")!.version });
    expect(parseFirmwareIdentity(appBytes("official"))).toMatchObject({ id: "official", projectName: "blackmagic" });
  });

  it("recognizes Flipforge Bridge across versions", () => {
    expect(parseFirmwareIdentity(appIdentity("flipforge_bridge", "0.2.0"))).toEqual({
      id: "bridge",
      projectName: "flipforge_bridge",
      version: "0.2.0",
    });
  });

  it("recognizes stock Blackmagic firmware", () => {
    expect(parseFirmwareIdentity(appIdentity("blackmagic", "1"))).toEqual({
      id: "official",
      projectName: "blackmagic",
      version: "1",
    });
  });

  it("recognizes Marauder by the verified release fingerprint", async () => {
    const bytes = appIdentity("arduino-lib-builder", "esp-idf: v4.4.5");
    const digest = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("");
    const marauder = { ...target("marauder"), appIdentitySha256: digest };
    expect(await resolveFirmwareIdentity(bytes, [marauder])).toEqual({
      id: "marauder",
      projectName: "arduino-lib-builder",
      version: "1.2.3",
    });
  });

  it("does not mislabel another ESP32-S2 application", () => {
    expect(parseFirmwareIdentity(appIdentity("custom_board", "4.1.0"))).toEqual({
      id: null,
      projectName: "custom_board",
      version: "4.1.0",
    });
  });

  it("rejects bytes without a valid ESP app descriptor", () => {
    expect(parseFirmwareIdentity(appIdentity("flipforge_bridge", "0.2.0", false))).toEqual({
      id: null,
      projectName: "",
      version: "",
    });
  });
});
