const queueModel = require("../services/queueService");
const { logAudit } = require("../utils/auditLogger");

// 1. Fetch live summary queue status for a specific event
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

// 2. Fetch specific live queue status for an individual participant
exports.getParticipantQueueStatus = async (req, res) => {
  try {
    const { participantId } = req.params;

    if (!participantId) {
      return res.status(400).json({ success: false, message: "Participant ID is required." });
    }

    const participantQueue = await queueModel.getQueueByParticipantId(participantId);

    if (!participantQueue) {
      return res.status(404).json({ success: false, message: "Participant not found in active queues." });
    }

    return res.status(200).json({
      success: true,
      data: participantQueue,
    });
  } catch (err) {
    console.error("Participant Queue Status Error:", err);
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
};

// 3. Register/join a participant into a queue line
exports.joinQueue = async (req, res) => {
  try {
    const { eventId, participantId, initialStationId } = req.body;

    if (!eventId || !participantId) {
      return res.status(400).json({ success: false, message: "Event ID and Participant ID are required." });
    }

    const newQueueItem = await queueModel.addParticipantToQueue(eventId, participantId, initialStationId);

    // Emit audit trail log
    await logAudit(
      req.user?.id,
      "QUEUE_JOINED",
      "QUEUE",
      { eventId, participantId },
      req.ip
    );

    return res.status(201).json({
      success: true,
      message: "Participant successfully added to queue.",
      data: newQueueItem,
    });
  } catch (err) {
    console.error("Join Queue Error:", err);
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
};

// 4. Advance a participant through queue stations
exports.advanceQueue = async (req, res) => {
  try {
    const { queueId } = req.params;
    const { nextStationId, status } = req.body;

    if (!queueId) {
      return res.status(400).json({ success: false, message: "Queue ID is required." });
    }

    const updatedItem = await queueModel.updateQueuePosition(queueId, nextStationId, status);

    // Emit audit trail log
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

// 5. Remove or cancel a participant from the queue
exports.leaveQueue = async (req, res) => {
  try {
    const { queueId } = req.params;

    if (!queueId) {
      return res.status(400).json({ success: false, message: "Queue ID is required." });
    }

    const removedItem = await queueModel.removeQueueItem(queueId);

    // Emit audit trail log
    await logAudit(
      req.user?.id,
      "QUEUE_LEFT",
      "QUEUE",
      { queueId, participantId: removedItem?.participantId },
      req.ip
    );

    return res.status(200).json({
      success: true,
      message: "Participant successfully removed from queue.",
      data: removedItem,
    });
  } catch (err) {
    console.error("Leave Queue Error:", err);
    return res.status(500).json({ success: false, message: "Internal server error." });
  }
};