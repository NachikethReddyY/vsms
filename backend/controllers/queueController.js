const queueModel = require("../models/queueModel");
const { logAudit } = require("../utils/auditLogger");

exports.getQueueStatus = async (req, res) => {
  try {
    const { eventId } = req.params;

    if (!eventId) {
      return res.status(400).json({ success: false, message: "Event ID is required." });
    }

    const queueItems = await queueModel.getQueueByEventId(eventId);

    return res.status(200).json({
      success: true,
      data: queueItems,
    });
  } catch (err) {
    console.error("Queue Status Error:", err);
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
};

exports.advanceQueue = async (req, res) => {
  try {
    const { queueId } = req.params;
    const { nextStationId, status } = req.body;

    if (!queueId) {
      return res.status(400).json({ success: false, message: "Queue ID is required." });
    }

    const updatedItem = await queueModel.updateQueuePosition(queueId, nextStationId, status);

    // Emit required audit trail log
    await logAudit(
      req.user?.id,
      "QUEUE_ADVANCED",
      "QUEUE",
      { queueId, participantId: updatedItem.participantId, nextStationId },
      req.ip
    );

    return res.status(200).json({
      success: true,
      message: "Queue advanced successfully.",
      data: updatedItem,
    });
  } catch (err) {
    console.error("Advance Queue Error:", err);
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
};