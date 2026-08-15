import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = resolve(projectRoot, "public", "firmware");
const officialIndexUrl = "https://update.flipperzero.one/blackmagic-firmware/directory.json";
const bridgeReleaseUrl = "https://api.github.com/repos/Flipforge-Software/flipforge-bridge/releases/latest";

function sha256(bytes) {
  return createHash("sha256").update(bytes).digest("hex");
}

async function fetchChecked(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { "User-Agent": "Flipforge-Web-Firmware-Sync", Accept: "application/vnd.github+json", ...options.headers },
  });
  if (!response.ok) throw new Error(`Request failed (${response.status}): ${url}`);
  return response;
}

function extractTarGz(archive) {
  const tar = gunzipSync(archive);
  const files = new Map();
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    if (header.every((byte) => byte === 0)) break;
    const rawName = header.subarray(0, 100).toString("utf8").replace(/\0.*$/, "");
    const name = rawName.replace(/^\.\//, "");
    const sizeText = header.subarray(124, 136).toString("ascii").replace(/\0.*$/, "").trim();
    const size = Number.parseInt(sizeText || "0", 8);
    if (!Number.isSafeInteger(size) || size < 0) throw new Error(`Invalid tar entry size: ${name}`);
    const type = header[156];
    const contentStart = offset + 512;
    const contentEnd = contentStart + size;
    if (contentEnd > tar.length) throw new Error(`Truncated tar entry: ${name}`);
    if (type === 0 || type === 48) files.set(name, Buffer.from(tar.subarray(contentStart, contentEnd)));
    offset = contentStart + Math.ceil(size / 512) * 512;
  }
  return files;
}

function safeVersion(value) {
  if (typeof value !== "string" || !/^\d+(?:\.\d+){1,3}(?:[-+][0-9A-Za-z.-]+)?$/.test(value)) {
    throw new Error(`Unsafe firmware version: ${String(value)}`);
  }
  return value;
}

async function writeTargetFiles(id, version, archive, expectedFiles) {
  const entries = extractTarGz(archive);
  const versionDirectory = resolve(outputRoot, id, version);
  await mkdir(versionDirectory, { recursive: true });
  const segments = [];
  for (const expected of expectedFiles) {
    const bytes = entries.get(expected.archivePath);
    if (!bytes?.length) throw new Error(`Required firmware image is missing: ${expected.archivePath}`);
    const outputPath = resolve(versionDirectory, expected.outputName);
    await writeFile(outputPath, bytes);
    segments.push({
      name: expected.name,
      address: expected.address,
      path: `firmware/${id}/${version}/${expected.outputName}`,
      size: bytes.length,
      sha256: sha256(bytes),
    });
  }
  return segments;
}

async function loadBridge() {
  const release = await (await fetchChecked(bridgeReleaseUrl)).json();
  const version = safeVersion(String(release.tag_name ?? "").replace(/^v/, ""));
  const archiveName = `flipforge-bridge-${version}.tar.gz`;
  const archiveAsset = release.assets?.find((asset) => asset.name === archiveName);
  const checksumAsset = release.assets?.find((asset) => asset.name === `${archiveName}.sha256`);
  if (!archiveAsset || !checksumAsset) throw new Error("Bridge release is missing its archive or checksum.");
  const archive = Buffer.from(await (await fetchChecked(archiveAsset.browser_download_url)).arrayBuffer());
  const checksumText = await (await fetchChecked(checksumAsset.browser_download_url)).text();
  const expectedHash = checksumText.trim().split(/\s+/)[0];
  const actualHash = sha256(archive);
  if (actualHash !== expectedHash) throw new Error("Bridge release archive failed SHA-256 verification.");
  const segments = await writeTargetFiles("bridge", version, archive, [
    { name: "Bootloader", address: 0x1000, archivePath: "bootloader/bootloader.bin", outputName: "bootloader.bin" },
    { name: "Partition table", address: 0x8000, archivePath: "partition_table/partition-table.bin", outputName: "partition-table.bin" },
    { name: "Flipforge Bridge", address: 0x10000, archivePath: "flipforge_bridge.bin", outputName: "flipforge-bridge.bin" },
  ]);
  return {
    id: "bridge",
    name: "Flipforge Bridge",
    shortName: "Bridge",
    version,
    description: "Connect the board to the Flipforge mobile app over a private local Wi-Fi link.",
    sourceName: "Flipforge Software",
    sourceUrl: release.html_url,
    archiveSha256: actualHash,
    chip: "ESP32-S2",
    flashMode: "dio",
    flashFrequency: "80m",
    flashSize: "4MB",
    segments,
  };
}

async function loadOfficial() {
  const index = await (await fetchChecked(officialIndexUrl, { headers: { Accept: "application/json" } })).json();
  const releaseChannel = index.channels?.find((channel) => channel.id === "release");
  const release = releaseChannel?.versions?.[0];
  const file = release?.files?.find((candidate) => candidate.type === "full_tgz" && candidate.target === "s2");
  const version = safeVersion(release?.version);
  if (!file?.url || !/^[a-f0-9]{64}$/.test(file.sha256 ?? "")) throw new Error("Official stable Devboard release is incomplete.");
  const archive = Buffer.from(await (await fetchChecked(file.url, { headers: { Accept: "application/octet-stream" } })).arrayBuffer());
  const actualHash = sha256(archive);
  if (actualHash !== file.sha256) throw new Error("Official Devboard archive failed SHA-256 verification.");
  const segments = await writeTargetFiles("official", version, archive, [
    { name: "Bootloader", address: 0x1000, archivePath: "bootloader.bin", outputName: "bootloader.bin" },
    { name: "Partition table", address: 0x8000, archivePath: "partition-table.bin", outputName: "partition-table.bin" },
    { name: "Original firmware", address: 0x10000, archivePath: "blackmagic.bin", outputName: "blackmagic.bin" },
  ]);
  return {
    id: "official",
    name: "Original Flipper Firmware",
    shortName: "Original",
    version,
    description: "Return the board to Flipper’s stable Blackmagic debug and Wi-Fi firmware.",
    sourceName: "Flipper Devices",
    sourceUrl: file.url,
    archiveSha256: actualHash,
    chip: "ESP32-S2",
    flashMode: "dio",
    flashFrequency: "80m",
    flashSize: "4MB",
    segments,
  };
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
const [bridge, official] = await Promise.all([loadBridge(), loadOfficial()]);
const catalog = { schemaVersion: 1, generatedAt: new Date().toISOString(), targets: [bridge, official] };
await writeFile(resolve(outputRoot, "manifest.json"), `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Firmware catalog ready: Bridge ${bridge.version}, official ${official.version}`);
