import { describe, expect, it } from "vitest";
import { isPotentialBridgePort, parseBridgePairingResponse } from "../src/pairing";

const secret = "a1".repeat(32);

describe("Bridge pairing response", () => {
  it("extracts a complete credential without retaining surrounding logs", () => {
    const parsed = parseBridgePairingResponse(`I (42) pairing ready\nFFPAIR1 Flipforge-8631 ABCDEFGHJKLMNPQRSTUV ${secret}\nI (43) done\n`);
    expect(parsed).toEqual({
      pairingLine: `FFPAIR1 Flipforge-8631 ABCDEFGHJKLMNPQRSTUV ${secret}`,
      ssid: "Flipforge-8631",
      wifiPassword: "ABCDEFGHJKLMNPQRSTUV",
      pairingSecret: secret,
    });
  });

  it("normalizes uppercase secret hex", () => {
    const parsed = parseBridgePairingResponse(`FFPAIR1 Flipforge-1234 password123 ${secret.toUpperCase()}\n`);
    expect(parsed.pairingSecret).toBe(secret);
  });

  it("rejects missing, malformed, and extra fields", () => {
    expect(() => parseBridgePairingResponse("pairing ready\n")).toThrow("did not return");
    expect(() => parseBridgePairingResponse(`FFPAIR1 Flipforge-1234 password123 ${secret} extra\n`)).toThrow("incomplete");
    expect(() => parseBridgePairingResponse(`FFPAIR1 Other-1234 password123 ${secret}\n`)).toThrow("Wi-Fi name");
    expect(() => parseBridgePairingResponse(`FFPAIR1 Flipforge-1234 short ${secret}\n`)).toThrow("Wi-Fi password");
    expect(() => parseBridgePairingResponse(`FFPAIR1 Flipforge-1234 password123 ${"z".repeat(64)}\n`)).toThrow("authentication secret");
  });
});

describe("Bridge USB detection", () => {
  it("recognizes Espressif runtime and bootloader ports without relying on a changing product ID", () => {
    expect(isPotentialBridgePort({ usbVendorId: 0x303a, usbProductId: 0x4002 })).toBe(true);
    expect(isPotentialBridgePort({ usbVendorId: 0x303a, usbProductId: 0x1001 })).toBe(true);
  });

  it("ignores unrelated USB serial devices", () => {
    expect(isPotentialBridgePort({ usbVendorId: 0x10c4, usbProductId: 0xea60 })).toBe(false);
    expect(isPotentialBridgePort({})).toBe(false);
  });
});
