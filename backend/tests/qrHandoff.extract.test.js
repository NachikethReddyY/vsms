/**
 * Lightweight pure-function checks for QR → station handoff helpers.
 * Run: node --test .tests/qrHandoff.extract.test.js
 *
 * Mirrors react-user-dashboard/src/features/screening/qrHandoff.ts extractQrToken.
 */
const test = require("node:test");
const assert = require("node:assert/strict");

function extractQrToken(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return null;

  try {
    const asUrl = new URL(trimmed);
    const pathMatch = asUrl.pathname.match(/\/participant-status\/([^/]+)\/?$/i);
    if (pathMatch?.[1]) return decodeURIComponent(pathMatch[1]);
  } catch {
    // not a full URL
  }

  const pathOnly = trimmed.match(/(?:^|\/)participant-status\/([^/?#]+)/i);
  if (pathOnly?.[1]) return decodeURIComponent(pathOnly[1]);

  return trimmed;
}

test("extractQrToken accepts demo seed token and hex", () => {
  assert.equal(extractQrToken("VSMS-DEMO-QR-001"), "VSMS-DEMO-QR-001");
  assert.equal(extractQrToken(`  ${"ab".repeat(32)}  `), "ab".repeat(32));
});

test("extractQrToken pulls token from participant-status URL", () => {
  const token = "a".repeat(64);
  assert.equal(
    extractQrToken(`http://192.168.1.10:3000/participant-status/${token}`),
    token,
  );
  assert.equal(extractQrToken(`/participant-status/${token}`), token);
});

test("extractQrToken rejects empty input", () => {
  assert.equal(extractQrToken(""), null);
  assert.equal(extractQrToken("   "), null);
});
