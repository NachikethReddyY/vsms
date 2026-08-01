const qrModel = require("../models/qrModel");

exports.generateQR = async (req, res) => {
    const qr = await qrModel.generateQR(req.params.participantId, req.user);
    res.status(201).json(qr);
};

exports.getParticipantByQR = async (req, res) => {
    res.json(await qrModel.getParticipant(req.body.token, req.user));
};
