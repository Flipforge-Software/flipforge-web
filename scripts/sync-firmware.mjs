import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { gunzipSync } from "node:zlib";

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const outputRoot = resolve(projectRoot, "public", "firmware");
const officialIndexUrl = "https://update.flipperzero.one/blackmagic-firmware/directory.json";
const bridgeReleaseUrl = "https://api.github.com/repos/Flipforge-Software/flipforge-bridge/releases/latest";
const marauderReleaseUrl = "https://api.github.com/repos/justcallmekoko/ESP32Marauder/releases/latest";
const appIdentityLength = 0x100;

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

async function writeBinaryTargetFiles(id, version, files) {
  const versionDirectory = resolve(outputRoot, id, version);
  await mkdir(versionDirectory, { recursive: true });
  const segments = [];
  let appIdentitySha256 = "";
  for (const file of files) {
    if (!file.bytes?.length) throw new Error(`Required firmware image is missing: ${file.outputName}`);
    const outputPath = resolve(versionDirectory, file.outputName);
    const bytes = file.bytes;
    await writeFile(outputPath, bytes);
    segments.push({
      name: file.name,
      address: file.address,
      path: `firmware/${id}/${version}/${file.outputName}`,
      size: bytes.length,
      sha256: sha256(bytes),
    });
    if (file.appIdentity) appIdentitySha256 = sha256(bytes.subarray(0, appIdentityLength));
  }
  if (!appIdentitySha256) throw new Error(`Application identity is missing for ${id}.`);
  return { segments, appIdentitySha256 };
}

async function writeTargetFiles(id, version, archive, expectedFiles) {
  const entries = extractTarGz(archive);
  return writeBinaryTargetFiles(id, version, expectedFiles.map((expected) => ({
    ...expected,
    bytes: entries.get(expected.archivePath),
  })));
}

function publishedAssetHash(asset) {
  const match = /^sha256:([a-f0-9]{64})$/.exec(asset?.digest ?? "");
  if (!match) throw new Error(`Release asset is missing a published SHA-256 digest: ${asset?.name ?? "unknown"}`);
  return match[1];
}

async function downloadVerifiedReleaseAsset(asset, expectedHash, expectedSize) {
  if (!asset?.browser_download_url || asset.size !== expectedSize || publishedAssetHash(asset) !== expectedHash) {
    throw new Error(`Release metadata does not match the Marauder manifest: ${asset?.name ?? "unknown"}`);
  }
  const bytes = Buffer.from(await (await fetchChecked(asset.browser_download_url, {
    headers: { Accept: "application/octet-stream" },
  })).arrayBuffer());
  if (bytes.length !== expectedSize || sha256(bytes) !== expectedHash) {
    throw new Error(`Marauder release asset failed verification: ${asset.name}`);
  }
  return bytes;
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
  const { segments, appIdentitySha256 } = await writeTargetFiles("bridge", version, archive, [
    { name: "Bootloader", address: 0x1000, archivePath: "bootloader/bootloader.bin", outputName: "bootloader.bin" },
    { name: "Partition table", address: 0x8000, archivePath: "partition_table/partition-table.bin", outputName: "partition-table.bin" },
    { name: "Flipforge Bridge", address: 0x10000, archivePath: "flipforge_bridge.bin", outputName: "flipforge-bridge.bin", appIdentity: true },
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
    appIdentitySha256,
    eraseAll: false,
    chip: "ESP32-S2",
    flashMode: "dio",
    flashFrequency: "80m",
    flashSize: "4MB",
    segments,
  };
}

async function loadMarauder() {
  const release = await (await fetchChecked(marauderReleaseUrl)).json();
  const version = safeVersion(String(release.tag_name ?? "").replace(/^v/, ""));
  const manifestAsset = release.assets?.find((asset) => asset.name === "firmware-manifest.json");
  if (!manifestAsset) throw new Error("Marauder release is missing its firmware manifest.");
  const manifestHash = publishedAssetHash(manifestAsset);
  const manifestBytes = await downloadVerifiedReleaseAsset(manifestAsset, manifestHash, manifestAsset.size);
  const manifest = JSON.parse(manifestBytes.toString("utf8"));
  const target = manifest.targets?.find((candidate) => candidate.id === "flipper-zero-wifi-dev-board");
  if (
    manifest.schemaVersion !== 1 ||
    manifest.metadataStatus !== "authoritative" ||
    manifest.sourceRepository !== "justcallmekoko/ESP32Marauder" ||
    manifest.version !== release.tag_name ||
    target?.chipFamily !== "ESP32-S2" ||
    target?.esptoolChip !== "esp32s2" ||
    target?.flash?.sizeBytes !== 4 * 1024 * 1024 ||
    target?.flash?.mode !== "dio" ||
    target?.flash?.frequency !== "80m" ||
    target?.flash?.factory?.erase !== true ||
    target?.flash?.factory?.preservesUserData !== false
  ) {
    throw new Error("Marauder release metadata is not compatible with the Flipper Wi-Fi Dev Board.");
  }

  const roleConfig = new Map([
    ["bootloader", { name: "Bootloader", address: 0x1000, outputName: "bootloader.bin" }],
    ["partition-table", { name: "Partition table", address: 0x8000, outputName: "partition-table.bin" }],
    ["ota-data", { name: "OTA data", address: 0xe000, outputName: "ota-data.bin" }],
    ["application", { name: "ESP32 Marauder", address: 0x10000, outputName: "esp32-marauder.bin", appIdentity: true }],
  ]);
  const factorySegments = target.flash.factory.segments;
  if (!Array.isArray(factorySegments) || factorySegments.length !== roleConfig.size) {
    throw new Error("Marauder factory image set is incomplete.");
  }

  const files = [];
  const seenRoles = new Set();
  for (const segment of factorySegments) {
    const config = roleConfig.get(segment.role);
    if (!config || seenRoles.has(segment.role) || segment.offset !== config.address) {
      throw new Error("Marauder factory flash offsets were rejected.");
    }
    if (!/^[a-f0-9]{64}$/.test(segment.sha256 ?? "") || !Number.isSafeInteger(segment.size) || segment.size <= 0) {
      throw new Error("Marauder firmware segment metadata is invalid.");
    }
    const asset = release.assets?.find((candidate) => candidate.name === segment.fileName);
    files.push({
      ...config,
      bytes: await downloadVerifiedReleaseAsset(asset, segment.sha256, segment.size),
    });
    seenRoles.add(segment.role);
  }

  const { segments, appIdentitySha256 } = await writeBinaryTargetFiles("marauder", version, files);
  return {
    id: "marauder",
    name: "ESP32 Marauder",
    shortName: "Marauder",
    version,
    description: "Install Marauder tools for Wi-Fi hardware you own or are authorized to test.",
    sourceName: "ESP32 Marauder",
    sourceUrl: release.html_url,
    archiveSha256: manifestHash,
    appIdentitySha256,
    eraseAll: true,
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
  const { segments, appIdentitySha256 } = await writeTargetFiles("official", version, archive, [
    { name: "Bootloader", address: 0x1000, archivePath: "bootloader.bin", outputName: "bootloader.bin" },
    { name: "Partition table", address: 0x8000, archivePath: "partition-table.bin", outputName: "partition-table.bin" },
    { name: "Original firmware", address: 0x10000, archivePath: "blackmagic.bin", outputName: "blackmagic.bin", appIdentity: true },
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
    appIdentitySha256,
    eraseAll: false,
    chip: "ESP32-S2",
    flashMode: "dio",
    flashFrequency: "80m",
    flashSize: "4MB",
    segments,
  };
}

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
const [bridge, marauder, official] = await Promise.all([loadBridge(), loadMarauder(), loadOfficial()]);
const catalog = { schemaVersion: 2, generatedAt: new Date().toISOString(), targets: [bridge, marauder, official] };
await writeFile(resolve(outputRoot, "manifest.json"), `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`Firmware catalog ready: Bridge ${bridge.version}, Marauder ${marauder.version}, official ${official.version}`);
