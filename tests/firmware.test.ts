import { describe, expect, it } from "vitest";
import { aggregateProgress } from "../src/flasher";
import { validateCatalog, type FirmwareCatalog } from "../src/firmware";

const hash = "a".repeat(64);
const target = (id: "bridge" | "official") => ({
  id,
  name: id,
  shortName: id,
  version: "1.2.3",
  description: "Test firmware",
  sourceName: "Test",
  sourceUrl: "https://example.com",
  archiveSha256: hash,
  chip: "ESP32-S2" as const,
  flashMode: "dio" as const,
  flashFrequency: "80m" as const,
  flashSize: "4MB" as const,
  segments: [
    { name: "Bootloader", address: 0x1000, path: `firmware/${id}/boot.bin`, size: 10, sha256: hash },
    { name: "Partition", address: 0x8000, path: `firmware/${id}/part.bin`, size: 20, sha256: hash },
    { name: "App", address: 0x10000, path: `firmware/${id}/app.bin`, size: 70, sha256: hash },
  ],
});

const catalog: FirmwareCatalog = {
  schemaVersion: 1,
  generatedAt: "2026-08-15T00:00:00Z",
  targets: [target("bridge"), target("official")],
};

describe("firmware catalog", () => {
  it("accepts the two known ESP32-S2 targets", () => {
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
});

describe("flash progress", () => {
  it("weights progress by segment size", () => {
    expect(aggregateProgress(0, 5, 10, [10, 20, 70])).toBeCloseTo(0.05);
    expect(aggregateProgress(1, 10, 20, [10, 20, 70])).toBeCloseTo(0.2);
    expect(aggregateProgress(2, 70, 70, [10, 20, 70])).toBe(1);
  });
});
