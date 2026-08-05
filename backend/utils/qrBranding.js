const QRCode = require("qrcode");

const VSMS_BRAND_COLOR = "#2563EB";

const VSMS_LOGO_PATHS = `
  <path d="M9 7H6v6M23 7h3v6M9 25H6v-6M23 25h3v-6" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" fill="none"/>
  <path d="M9 21c3.6 0 3.8-10 7.3-10 2.4 0 2.8 5.3 6.7 5.3" stroke="currentColor" stroke-width="2" stroke-linecap="round" fill="none"/>
  <circle cx="9" cy="21" r="2" fill="currentColor"/>
  <circle cx="16.3" cy="11" r="2" fill="currentColor"/>
  <circle cx="23" cy="16.3" r="2" fill="currentColor"/>
`;

/**
 * Render a branded VSMS QR pass as an SVG data URL.
 *
 * The raw QR matrix is preserved untouched; a small white logo patch sits in
 * the center (safe under error-correction level H) and a VSMS wordmark band is
 * appended below the matrix so scanners keep a clean code area.
 */
async function renderBrandedQrSvg(text, { width = 300, margin = 2, brandColor = VSMS_BRAND_COLOR } = {}) {
    const svg = await QRCode.toString(text, {
        type: "svg",
        errorCorrectionLevel: "H",
        margin,
        width,
    });

    const viewBox = svg.match(/viewBox="0 0 (\d+) (\d+)"/);
    const W = Number(viewBox[1]);
    const H = Number(viewBox[2]);

    const contentStart = svg.indexOf(">") + 1;
    const contentEnd = svg.lastIndexOf("</svg>");
    const matrix = svg.slice(contentStart, contentEnd);

    const captionHeight = Math.max(22, Math.round(W * 0.3));
    const totalHeight = H + captionHeight;
    const scale = width / W;
    const renderHeight = Math.round(totalHeight * scale);

    const patchRadius = Math.max(3, Math.round(W * 0.13));
    const cx = W / 2;
    const cy = H / 2;
    const logoDisplaySize = patchRadius * 2 * 0.62;
    const logoScale = logoDisplaySize / 32;
    const borderWidth = Math.max(0.8, W * 0.028);
    const captionCenterY = H + captionHeight * 0.52;
    const captionFontSize = Math.max(11, Math.round(captionHeight * 0.5));

    const branded = [
        `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${renderHeight}" viewBox="0 0 ${W} ${totalHeight}" shape-rendering="crispEdges">`,
        `<path fill="#ffffff" d="M0 0h${W}v${totalHeight}H0z"/>`,
        `<g>${matrix}</g>`,
        `<rect x="${(cx - patchRadius).toFixed(2)}" y="${(cy - patchRadius).toFixed(2)}" width="${(patchRadius * 2).toFixed(2)}" height="${(patchRadius * 2).toFixed(2)}" rx="${(patchRadius * 0.28).toFixed(2)}" fill="#ffffff" stroke="${brandColor}" stroke-width="${borderWidth.toFixed(2)}"/>`,
        `<g transform="translate(${cx.toFixed(2)} ${cy.toFixed(2)}) scale(${logoScale.toFixed(4)}) translate(-16 -16)" color="${brandColor}">${VSMS_LOGO_PATHS}</g>`,
        `<text x="${(W / 2).toFixed(2)}" y="${captionCenterY.toFixed(2)}" font-family="Arial, Helvetica, sans-serif" font-size="${captionFontSize}" font-weight="700" letter-spacing="3" text-anchor="middle" fill="${brandColor}">VSMS</text>`,
        `<text x="${(W / 2).toFixed(2)}" y="${(H + captionHeight * 0.88).toFixed(2)}" font-family="Arial, Helvetica, sans-serif" font-size="${Math.max(8, Math.round(captionFontSize * 0.42))}" letter-spacing="1.5" text-anchor="middle" fill="#475569">SECURE EVENT PASS</text>`,
        "</svg>",
    ].join("");

    return `data:image/svg+xml;base64,${Buffer.from(branded, "utf8").toString("base64")}`;
}

function isBrandedQrSvgDataUrl(value) {
    return typeof value === "string" && value.startsWith("data:image/svg+xml;base64,");
}

module.exports = {
    VSMS_BRAND_COLOR,
    renderBrandedQrSvg,
    isBrandedQrSvgDataUrl,
};
