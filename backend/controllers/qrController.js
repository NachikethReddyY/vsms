const qrModel = require("../models/qrModel");

exports.generateQR = async (req, res) => {
    const qr = await qrModel.generateQR(req.params.participantId);
    res.status(201).json(qr);
};

exports.getParticipantByQR = async (req, res) => {
    res.json(await qrModel.getParticipant(req.params.token));
};