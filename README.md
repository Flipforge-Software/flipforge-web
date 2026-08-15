# Flipforge Devboard Utility

Browser-based installer and recovery helper for the official Flipper Zero ESP32-S2 Wi-Fi Devboard.

Production runs on Cloudflare Workers Static Assets. The interface is intentionally a single utility workspace: firmware selection, board preparation, persistent console, live progress, completion, and recovery.

It provides two bounded firmware paths:

- **Install Flipforge Bridge** from the latest public `Flipforge-Software/flipforge-bridge` release.
- **Restore Original** from the stable release in Flipper Devices' official Blackmagic firmware index.

The site accepts no arbitrary firmware or offsets. At build time it downloads the two upstream archives, verifies their published SHA-256 checksums, extracts only the three expected ESP32-S2 images, and emits a bounded firmware catalog. The browser verifies each extracted image again before passing it to `esptool-js` over Web Serial.

## Browser support

Flashing requires a secure context and Web Serial. Use desktop Chrome or Edge. iPhone and iPad browsers do not expose Web Serial, so the site presents a computer handoff instead of a nonfunctional flash control.

## Local development

```bash
npm install
npm test
npm run dev
```

`npm run dev` and `npm run build` synchronize verified current firmware into ignored `public/firmware/` output.

## Cloudflare Workers

```bash
npx wrangler whoami
npm run deploy
```

`wrangler.jsonc` deploys `dist/` as Workers Static Assets with SPA fallback. The browser still talks directly to the board through Web Serial; Cloudflare only serves the application and verified firmware files.

## Safety boundaries

- Official ESP32-S2 Wi-Fi Devboard only.
- Exact chip check before writing.
- Exact known offsets: `0x1000`, `0x8000`, and `0x10000`.
- DIO, 80 MHz, 4 MB settings from both upstream flash manifests.
- No full-chip erase.
- No arbitrary firmware upload.
- No serial or firmware data sent to Flipforge servers.
- A successful flash still requires the user to press RESET on the board.

This utility flashes the Wi-Fi Devboard. It does not modify Flipper Zero firmware.
