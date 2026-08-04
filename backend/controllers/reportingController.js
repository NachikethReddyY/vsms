const reportingService = require("../services/reportingService");
const { createAuditLog } = require("../utils/audit");

exports.operations = async (req, res) => {
  const report = await reportingService.getOperationalReport(req.query, req.user);
  await createAuditLog({
    userId: req.user.userId,
    action: "REPORT_VIEWED",
    entityName: "OperationalReport",
    entityId: req.query.eventId,
    newValue: {
      eventId: req.query.eventId || null,
      from: report.filters.from,
      to: report.filters.to,
      eventCount: report.events.length,
    },
    context: req.context,
  });
  res.set("Cache-Control", "no-store").json(report);
};
