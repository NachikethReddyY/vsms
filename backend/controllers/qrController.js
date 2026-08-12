const qrService = require("../services/participant/qrService");
const env = require("../config/env");
const { assertUuid } = require("../utils/validation/validation");
const { assertRegistrationAssignment, assertQrVerifyAccess } = require("../utils/auth/staff");

const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character]));

async function assertQrAccess(req, selectors) {
    return qrService.assertRegistrationAccess(selectors, req.auth);
}

async function assertVerifyAccess(req, selectors) {
    return qrService.assertVerificationAccess(selectors, req.auth);
}

// Registration-module compatibility endpoint
exports.generateRegistrationQR = async (req, res, next) => {
    try {
        await assertQrAccess(req, { registrationId: req.params.registrationId });
        const qr = await qrService.generateRegistrationQR(
            req.params.registrationId,
            req.auth.userId,
            { ipAddress: req.ip }
        );
        const { token: _token, ...safeQr } = qr;
        return res.status(201).json(safeQr);
    } catch (err) {
        next(err);
    }
};

exports.getRegistrationByQR = async (req, res, next) => {
    try {
        await assertQrAccess(req, { token: req.params.token });
        const result = await qrService.getRegistrationByQR(req.params.token);
        return res.json({ registration: result });
    } catch (err) {
        next(err);
    }
};

// ==========================================
// Generate QR Code
// POST /qr/generate/:registrationId
// ==========================================
exports.generateQR = async (req, res, next) => {
    try {
        const { registrationId } = req.params;
        const userId = req.auth.userId;
        await assertQrAccess(req, { registrationId });

        const qr = await qrService.generateQR(registrationId, userId, null, { ipAddress: req.ip });

        const { token: _token, ...safeQr } = qr;

        return res.status(201).json({
            success: true,
            message: "QR Code generated successfully.",
            data: safeQr
        });
    } catch (err) {
        next(err);
    }
};

// ==========================================
// Verify QR Token
// POST /qr/verify
// ==========================================
exports.verifyQR = async (req, res, next) => {
    try {
        const { token, eventId, scanId } = req.body;
        const userId = req.auth.userId;
        assertUuid(scanId, "scanId");
        await assertVerifyAccess(req, { token, eventId });

        const result = await qrService.verifyQR(token, eventId, userId, undefined, {
            scanId,
            ipAddress: req.ip,
            deviceName: req.get("user-agent") || "QR scanner",
        });

        return res.status(200).json({
            success: true,
            data: result
        });
    } catch (err) {
        next(err);
    }
};

// ==========================================
// Public Pass Status (no auth, no PII)
// GET /qr/public-status/:token
// ==========================================
exports.getPublicStatus = async (req, res, next) => {
    try {
        const { token } = req.params;
        const status = await qrService.getPublicStatus(token);
        return res.set("Cache-Control", "no-store").json({ success: true, data: status });
    } catch (err) {
        next(err);
    }
};

// ==========================================
// Get Participant By QR
// GET /qr/participant/:token
// ==========================================
exports.getParticipantByQR = async (req, res, next) => {
    try {
        const { token } = req.params;
        await assertQrAccess(req, { token });
        const participant = await qrService.getParticipant(token);

        return res.status(200).json({
            success: true,
            data: participant
        });
    } catch (err) {
        next(err);
    }
};

// ==========================================
// Revoke QR Code
// PUT /qr/revoke/:qrId
// ==========================================
exports.revokeQR = async (req, res, next) => {
    try {
        const { qrId } = req.params;
        const { revokedReason } = req.body;
        const revokedBy = req.auth.userId;
        await assertQrAccess(req, { qrId });

        const qr = await qrService.revokeQR(qrId, revokedReason, revokedBy, undefined, { ipAddress: req.ip });

        return res.status(200).json({
            success: true,
            message: "QR Code revoked successfully.",
            data: qr
        });
    } catch (err) {
        next(err);
    }
};

// ==========================================
// Reissue QR Code
// POST /qr/reissue/:registrationId
// ==========================================
exports.reissueQR = async (req, res, next) => {
    try {
        const { registrationId } = req.params;
        const userId = req.auth.userId;
        await assertQrAccess(req, { registrationId });

        const qr = await qrService.reissueQR(registrationId, userId, undefined, { ipAddress: req.ip });
        const { token: _token, ...safeQr } = qr;

        return res.status(201).json({
            success: true,
            message: "QR Code reissued successfully.",
            data: safeQr
        });
    } catch (err) {
        next(err);
    }
};

// ==========================================
// Download QR Code
// GET /qr/download/:qrId
// ==========================================
exports.downloadQR = async (req, res, next) => {
    try {
        const { qrId } = req.params;
        await assertQrAccess(req, { qrId });
        const qr = await qrService.downloadQR(qrId);

        return res.status(200).json({
            success: true,
            data: qr
        });
    } catch (err) {
        next(err);
    }
};

// ==========================================
// Print QR Code
// GET /qr/print/:qrId
// ==========================================
exports.printQR = async (req, res, next) => {
    try {
        const { qrId } = req.params;
        await assertQrAccess(req, { qrId });
        const qr = await qrService.printQR(qrId);

        return res.status(200).json({
            success: true,
            data: qr
        });
    } catch (err) {
        next(err);
    }
};

// ==========================================
// View QR Code as SVG in browser
// GET /qr/view/:registrationId
// ==========================================
exports.viewQR = async (req, res, next) => {
    try {
        await assertQrAccess(req, { registrationId: req.params.registrationId });
        const qr = await qrService.generateRegistrationQR(
            req.params.registrationId,
            req.auth.userId,
            { ipAddress: req.ip }
        );
        const svgBase64 = qr.qrImage.split(",")[1]; // strip data:image/svg+xml;base64,
        const svg = Buffer.from(svgBase64, "base64").toString("utf8");
        res.set("Content-Type", "image/svg+xml");
        res.set("Cache-Control", "no-store");
        return res.send(svg);
    } catch (err) {
        next(err);
    }
};

// ==========================================
// View QR Code as SVG in browser â€” DEVELOPMENT ONLY
// GET /qr/dev-view/:registrationId
// No auth required. Returns 403 outside development/test.
// ==========================================
exports.devViewQR = async (req, res, next) => {
    try {
        if (env.isProduction) {
            return res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Not available in production" } });
        }
        assertUuid(req.params.registrationId, "registrationId");
        const qr = await qrService.generateRegistrationQR(
            req.params.registrationId,
            null,
            { ipAddress: req.ip }
        );
        const svgBase64 = qr.qrImage.split(",")[1];
        const svg = Buffer.from(svgBase64, "base64").toString("utf8");
        res.set("Content-Type", "image/svg+xml");
        res.set("Cache-Control", "no-store");
        return res.send(svg);
    } catch (err) {
        next(err);
    }
};

// ==========================================
// Dev QR scan-check page â€” DEVELOPMENT ONLY
// GET /qr/dev-page/:registrationId
// Renders a centered, large QR with participant/event info
// and a live status poller. No auth. 403 outside dev/test.
// ==========================================
exports.devPageQR = async (req, res, next) => {
    try {
        if (env.isProduction) {
            return res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Not available in production" } });
        }
        const registrationId = assertUuid(req.params.registrationId, "registrationId");

        const pageData = await qrService.getDevPageData(registrationId, { ipAddress: req.ip });
        if (!pageData) {
            return res.status(404).send("<h1>Registration not found</h1>");
        }

        const scanQr = pageData.scanQr;
        const statusUrl = pageData.statusUrl;
        const token = pageData.statusUrl
            ? decodeURIComponent(pageData.statusUrl.split("/").pop())
            : null;
        const queueNumber = pageData.queueNumber;
        const displayName = pageData.displayName;

        const page = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>VSMS QR Pass â€” ${escapeHtml(displayName)}</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    background: #f1f5f9;
    display: flex;
    min-height: 100vh;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .card {
    background: #ffffff;
    border-radius: 16px;
    box-shadow: 0 10px 30px rgba(15, 23, 42, 0.12);
    padding: 40px;
    max-width: 560px;
    width: 100%;
    text-align: center;
  }
  .qr-wrap {
    background: #ffffff;
    padding: 16px;
    border-radius: 12px;
    border: 1px solid #e2e8f0;
    display: inline-block;
    margin-bottom: 20px;
  }
  .qr-wrap svg { display: block; width: 420px; height: auto; }
  h1 { font-size: 22px; color: #0f172a; margin-bottom: 4px; }
  .sub { color: #64748b; font-size: 14px; margin-bottom: 16px; }
  .meta { font-size: 15px; color: #334155; margin-bottom: 20px; }
  .meta b { color: #0f172a; }
  .status {
    font-size: 16px; font-weight: 700; padding: 12px;
    border-radius: 10px; margin-bottom: 16px;
  }
  .status.valid { background: #dcfce7; color: #166534; }
  .status.invalid { background: #fee2e2; color: #991b1b; }
  .status.pending { background: #fef9c3; color: #854d0e; }
  .hint { color: #94a3b8; font-size: 12px; margin-top: 12px; word-break: break-all; }
  .err { color: #dc2626; font-size: 13px; margin-top: 10px; }
</style>
</head>
<body>
  <div class="card">
    <div class="qr-wrap">${pageData.scanQr}</div>
    <h1>${escapeHtml(pageData.displayName)}</h1>
    <div class="sub">${escapeHtml(pageData.eventName)}</div>
    <div class="meta">
      Queue number: <b>${escapeHtml(queueNumber ?? "â€”")}</b>
      ${token ? `&nbsp;Â·&nbsp; Token: <code style="font-size:12px">${escapeHtml(token.slice(0, 12))}â€¦</code>` : ""}
    </div>
    <div id="status" class="status pending">Checking pass statusâ€¦</div>
    <div id="err" class="err"></div>
    <div class="hint">Scan this QR with a phone camera â€” it opens a status page served by the backend on your LAN.</div>
  </div>
<script>
  const statusEl = document.getElementById("status");
  const errEl = document.getElementById("err");
  const statusUrl = ${JSON.stringify(pageData.statusUrl)};

  async function check() {
    if (!statusUrl) {
      statusEl.className = "status invalid";
      statusEl.textContent = "No active pass token found";
      return;
    }
    try {
      const res = await fetch(statusUrl);
      const body = await res.json();
      const data = body.data || {};
      const ok = res.ok && data.valid;
      statusEl.className = ok ? "status valid" : "status invalid";
      statusEl.textContent = ok
        ? "VALID â€” pass is active and scannable"
        : (body.message || "INVALID â€” pass expired or revoked");
    } catch (e) {
      errEl.textContent = "Status check failed: " + e.message;
    }
  }
  check();
  setInterval(check, 5000);
</script>
</body>
</html>`;

        res.set("Content-Type", "text/html; charset=utf-8");
        res.set("Cache-Control", "no-store");
        return res.send(page);
    } catch (err) {
        next(err);
    }
};

// ==========================================
// Dev phone-friendly status page â€” DEVELOPMENT ONLY
// GET /qr/dev-status/:token
// This is the QR scan target in dev. No auth, 403 in production.
// ==========================================
exports.devStatusQR = async (req, res, next) => {
    try {
        if (env.isProduction) {
            return res.status(403).json({ success: false, error: { code: "FORBIDDEN", message: "Not available in production" } });
        }
        const page = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>VSMS Pass Status</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: Arial, Helvetica, sans-serif;
    background: #f1f5f9;
    min-height: 100vh;
    display: flex;
    align-items: center;
    justify-content: center;
    padding: 24px;
  }
  .card {
    background: #ffffff;
    border-radius: 16px;
    box-shadow: 0 10px 30px rgba(15, 23, 42, 0.12);
    padding: 40px;
    max-width: 460px;
    width: 100%;
    text-align: center;
  }
  .brand { font-size: 14px; font-weight: 800; letter-spacing: 3px; color: #2563EB; margin-bottom: 20px; }
  .status { font-size: 20px; font-weight: 700; padding: 16px; border-radius: 12px; }
  .status.valid { background: #dcfce7; color: #166534; }
  .status.invalid { background: #fee2e2; color: #991b1b; }
  .status.pending { background: #fef9c3; color: #854d0e; }
  .detail { color: #334155; font-size: 15px; margin-top: 18px; }
  .detail b { color: #0f172a; }
  .err { color: #dc2626; font-size: 13px; margin-top: 12px; }
</style>
</head>
<body>
  <div class="card">
    <div class="brand">VSMS SECURE EVENT PASS</div>
    <div id="status" class="status pending">Checkingâ€¦</div>
    <div id="detail" class="detail"></div>
    <div id="err" class="err"></div>
  </div>
<script>
  const statusEl = document.getElementById("status");
  const detailEl = document.getElementById("detail");
  const errEl = document.getElementById("err");

  async function check() {
    try {
      const res = await fetch(window.location.pathname.replace("/dev-status/", "/public-status/"));
      const body = await res.json();
      const data = body.data || {};
      const ok = res.ok && data.valid;
      statusEl.className = ok ? "status valid" : "status invalid";
      statusEl.textContent = ok ? "VALID" : "INVALID";
      detailEl.innerHTML = data.eventName ? "Event: <b>" + data.eventName + "</b><br>Queue: <b>" + (data.queueNumber || "â€”") + "</b>" : "";
      if (!ok) detailEl.innerHTML += "<br>This pass is expired or revoked.";
    } catch (e) {
      errEl.textContent = "Status check failed: " + e.message;
    }
  }
  check();
</script>
</body>
</html>`;

        res.set("Content-Type", "text/html; charset=utf-8");
        res.set("Cache-Control", "no-store");
        return res.send(page);
    } catch (err) {
        next(err);
    }
};
// POST /qr/manual-checkin
// ==========================================
exports.manualCheckIn = async (req, res, next) => {
    try {
        const { registrationId, identifier, eventId } = req.body;
        const userId = req.auth.userId;
        // Manual check-in accepts a registration reference or an active QR token. NRIC is
        // deliberately not searchable. Authorize the claimed event before resolving either.
        await assertQrAccess(req, { eventId });

        const result = await qrService.manualCheckIn({
            registrationId,
            identifier,
            eventId,
            userId,
            ipAddress: req.ip
        });

        return res.status(200).json({
            success: true,
            message: "Participant checked in successfully.",
            data: result
        });
    } catch (err) {
        next(err);
    }
};
