const participantModel = require("../models/participantModel");

exports.createParticipant = async (req, res) => {
    console.log("Controller reached");

    try {
        const participant = await participantModel.createParticipant(req.body);

        res.status(201).json({
            success: true,
            participant
        });
    } catch (err) {
        console.error(err);
        res.status(500).json({
            success: false,
            message: err.message
        });
    }
};