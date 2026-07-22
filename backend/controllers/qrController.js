const qrModel = require("../models/qrModel");

exports.generateQR = async (req, res) => {

    try {

        console.log("URL:", req.originalUrl);
        console.log("Params:", req.params);

        const participantId = req.params.participantId;

        const qr = await qrModel.generateQR(participantId);
        res.status(200).json(qr);

    } catch (err) {

        console.error(err);

        res.status(500).json({
            message: err.message
        });

    }

};

exports.getParticipantByQR = async (req, res) => {

    try {

        const token = req.params.token;

        const participant = await qrModel.getParticipant(token);

        res.status(200).json(participant);

    } catch (err) {

        res.status(500).json({
            message: err.message
        });

    }

};