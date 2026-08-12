const QRCode = require("qrcode");
const crypto = require("crypto");
const logger = require("./logger/logger");

/**
 * Generates a branded and secure QR code for a participant.
 * * @param {string} participantId - The unique ID of the participant.
 * @param {object} [customOptions={}] - Branding and styling options.
 * @returns {Promise<{token: string, qrImage: string}>}
 */
async function generateBrandedQR(participantId, customOptions = {}) {
    try {
        // 1. Generate a secure unique token
        const token = crypto.randomBytes(32).toString("hex");

        // 2. Define the payload (kept compact for efficient scanning)
        const payload = {
            id: participantId,
            t: token,
            generatedAt: new Date().toISOString()
        };

        const jsonString = JSON.stringify(payload);

        // 3. Define branding and default styling options
        const defaultOptions = {
            errorCorrectionLevel: 'M', // Balance between data density and error recovery
            type: 'image/png',
            quality: 0.92,
            margin: 2, // White space border around the QR code
            color: {
                dark: customOptions.darkColor || "#1E293B",  // Custom dark modules (Default: Slate dark)
                light: customOptions.lightColor || "#FFFFFF" // Background color (Default: White)
            },
            width: customOptions.width || 300 // Resolution width in pixels
        };

        // 4. Generate the QR code data URL
        const qrImage = await QRCode.toDataURL(jsonString, defaultOptions);

        return {
            token,
            qrImage
        };
    } catch {
        logger.error("qr_generation.failed", {
            event: "qr_generation.failed",
            code: "QR_GENERATION_FAILED",
        });
        throw new Error("QR Code generation failed");
    }
}

module.exports = {
    generateBrandedQR
};
