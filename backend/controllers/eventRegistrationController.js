const registrationModel = require("../models/eventRegistrationModel");

exports.createRegistration = async (req, res) => {

    try {

        const registration =
            await registrationModel.createRegistration(req.body);

        return res.status(201).json({
            success: true,
            message: "Participant registered successfully.",
            data: registration
        });

    } catch (err) {

        console.error(err);

        return res.status(500).json({
            success: false,
            message: err.message
        });

    }

};

exports.getRegistration = async (req, res) => {

    try {

        const registration =
            await registrationModel.getRegistration(req.params.id);

        return res.status(200).json({
            success: true,
            data: registration
        });

    } catch (err) {

        return res.status(500).json({
            success: false,
            message: err.message
        });

    }

};

exports.getParticipantRegistrations = async (req, res) => {

    try {

        const registrations =
            await registrationModel.getParticipantRegistrations(
                req.params.participantId
            );

        return res.status(200).json({
            success: true,
            data: registrations
        });

    } catch (err) {

        return res.status(500).json({
            success: false,
            message: err.message
        });

    }

};