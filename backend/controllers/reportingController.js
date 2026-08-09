const reportingService = require("../services/reporting/reportingService");
const analyticsService = require("../services/reporting/analyticsService");
const reportExportService = require("../services/reporting/reportExportService");
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

exports.analytics = async (req, res) => {
  const analytics = await analyticsService.getCompletedEventAnalytics(req.params.eventId, req.query, req.user);
  await createAuditLog({ userId: req.user.userId, action: "EVENT_ANALYTICS_VIEWED", entityName: "Event", entityId: req.params.eventId, newValue: { from: analytics.timeBasis.from, to: analytics.timeBasis.to }, context: req.context });
  res.set("Cache-Control", "no-store").json(analytics);
};

exports.createExport = async (req, res) => {
  res.status(202).set("Cache-Control", "no-store").json(await reportExportService.createReportJob(req.params.eventId, req.body, req.user, req.context));
};

exports.listExports = async (req, res) => {
  res.set("Cache-Control", "no-store").json(await reportExportService.listReportJobs(req.params.eventId, req.query, req.user));
};

exports.exportDetail = async (req, res) => {
  res.set("Cache-Control", "no-store").json(await reportExportService.getReportJob(req.params.eventId, req.params.jobId, req.user));
};

exports.downloadExport = async (req, res) => {
  const artifact = await reportExportService.downloadReportArtifact(req.params.eventId, req.params.jobId, req.user, req.context);
  res.set({
    "Cache-Control": "no-store",
    "Content-Type": artifact.mimeType,
    "Content-Disposition": `attachment; filename="${artifact.filename}"`,
    "Content-Length": artifact.contents.length,
    "Digest": `sha-256=${Buffer.from(artifact.sha256, "hex").toString("base64")}`,
  }).send(artifact.contents);
};
