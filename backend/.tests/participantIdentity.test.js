const { decrypt, encrypt, lookupHash } = require("../utils/cryptoUtils");

describe("participant identifier protection", () => {
  test("uses randomized authenticated encryption for stored identifiers", () => {
    const first = encrypt("S1234567A");
    const second = encrypt("S1234567A");

    expect(first).not.toBe(second);
    expect(decrypt(first)).toBe("S1234567A");
    expect(decrypt(second)).toBe("S1234567A");
  });

  test("uses a deterministic keyed hash for exact duplicate lookup", () => {
    expect(lookupHash("S1234567A")).toBe(lookupHash("S1234567A"));
    expect(lookupHash("S1234567A")).not.toBe(lookupHash("S1234567B"));
    expect(lookupHash("S1234567A")).toMatch(/^[a-f0-9]{64}$/);
  });
});
