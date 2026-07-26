const asyncHandler = require("../middlewares/asyncHandler");
const qrModel = require("../models/qrModel");
const { assertUuid, cleanString } = require("../utils/validation");

exports.generateQR = asyncHandler(async (req, res) => {
    const registrationId = assertUuid(req.params.registrationId, "registrationId");
    const qr = await qrModel.generateQR(registrationId, req.auth.userId);
    res.status(201).json(qr);
});

exports.getRegistrationByQR = asyncHandler(async (req, res) => {
    const token = cleanString(req.params.token, "token", { required: true, max: 200 });
    const registration = await qrModel.getRegistration(token);
    res.json({ registration });
});
