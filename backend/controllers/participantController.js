const participantModel = require("../models/participantModel");

exports.createParticipant = async (req, res) => {
  console.log("========== CREATE PARTICIPANT ==========");
  console.log("Request Body:", req.body);
  console.log("Authenticated User:", req.user);

  try {
    // 1. Extract parameters
    const {
      eventId,
      initialStationId,
      userId: bodyUserId,
      ...participantData
    } = req.body;

    // 2. Resolve userId (Auth middleware token > request body)
    const userId = req.user?.id || bodyUserId;

    // 3. Validation: Catch missing required fields BEFORE calling the model
    if (!eventId) {
      return res.status(400).json({
        success: false,
        message: "'eventId' is required to register a participant.",
      });
    }

    if (!userId) {
      return res.status(400).json({
        success: false,
        message: "'userId' is required for the audit log.",
      });
    }

    // 4. Fallback for initialStationId (optional station default)
    const stationId = initialStationId || null;

    // 5. Create participant record via model
    const participant = await participantModel.createParticipant(
      participantData,
      eventId,
      userId,
      stationId
    );

    console.log("Participant created successfully:", participant);

    return res.status(201).json({
      success: true,
      message: "Participant created successfully.",
      data: participant,
    });
  } catch (err) {
    console.error("Create Participant Error:", err);

    // Prisma / Unique constraint violation (e.g. NRIC already exists)
    if (err.code === "P2002") {
      return res.status(409).json({
        success: false,
        message: "Participant with this NRIC already exists.",
      });
    }

    return res.status(500).json({
      success: false,
      message: err.message || "Internal server error.",
    });
  }
};