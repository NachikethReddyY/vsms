const QRCode = require("qrcode");
const crypto = require("crypto");


async function generateQR(participantId) {


    // Generate unique QR token
    const token = crypto.randomBytes(32).toString("hex");


    const qrData = {

        participantId,

        token,

        generatedAt: new Date().toISOString()

    };


    const qrImage = await QRCode.toDataURL(
        JSON.stringify(qrData)
    );


    return {

        token,

        qrImage

    };

}


module.exports = {
    generateQR
};