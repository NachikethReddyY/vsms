const auditService = require("../services/auditService");

exports.getAuditLogs = async (req, res) => {
  const result = await auditService.getAuditLogs(req.query, req.user);
  res.json(result);
};

exports.getAuditLogById = async (req, res) => {
  const result = await auditService.getAuditLogById(req.params.id, req.user);
  res.json(result);
};

exports.getAuditHistoryByEntity = async (req, res) => {
  const { entityName, entityId } = req.params;
  const result = await auditService.getAuditHistoryByEntity(entityName, entityId, req.user);
  res.json(result);
};