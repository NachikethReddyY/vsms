const QRCode = require("qrcode");

const VSMS_BRAND_COLOR = "#2563EB";

/**
 * Render a clean VSMS QR pass as an SVG data URL.
 *
 * The raw QR matrix is rendered as-is with no logo overlay and no caption
 * band, so the code area stays scannable and the pass stays simple.
 */
async function renderBrandedQrSvg(text, { width = 300, margin = 2 } = {}) {
    const svg = await QRCode.toString(text, {
        type: "svg",
        errorCorrectionLevel: "H",
        margin,
        width,
    });

    return `data:image/svg+xml;base64,${Buffer.from(svg, "utf8").toString("base64")}`;
}

function isBrandedQrSvgDataUrl(value) {
    return typeof value === "string" && value.startsWith("data:image/svg+xml;base64,");
}

module.exports = {
    VSMS_BRAND_COLOR,
    renderBrandedQrSvg,
    isBrandedQrSvgDataUrl,
};
