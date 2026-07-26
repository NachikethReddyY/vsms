const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

// GET /api/v1/audit-logs - Query & Filter Audit Trail
const getAuditLogs = async (req, res) => {
  try {
    const { page = 1, limit = 20, entityName, userId, action } = req.query;
    const skip = (Number(page) - 1) * Number(limit);

    const where = {};
    if (entityName) where.entityName = entityName;
    if (userId) where.userId = userId;
    if (action) where.action = { contains: action, mode: 'insensitive' };

    const [total, logs] = await Promise.all([
      prisma.auditLog.count({ where }),
      prisma.auditLog.findMany({
        where,
        take: Number(limit),
        skip,
        orderBy: { createdAt: 'desc' },
        include: {
          user: {
            select: { id: true, fullName: true, email: true },
          },
        },
      }),
    ]);

    return res.status(200).json({
      success: true,
      data: logs,
      pagination: {
        total,
        page: Number(page),
        pages: Math.ceil(total / Number(limit)),
      },
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/audit-logs/:id - Fetch single audit record
const getAuditLogById = async (req, res) => {
  try {
    const { id } = req.params;
    const log = await prisma.auditLog.findUnique({
      where: { id },
      include: {
        user: { select: { id: true, fullName: true, email: true } },
      },
    });

    if (!log) {
      return res.status(404).json({ success: false, message: 'Audit log entry not found' });
    }

    return res.status(200).json({ success: true, data: log });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

// GET /api/v1/audit-logs/entity/:entityName/:entityId - Entity change history
const getAuditHistoryByEntity = async (req, res) => {
  try {
    const { entityName, entityId } = req.params;

    const history = await prisma.auditLog.findMany({
      where: { entityName, entityId },
      orderBy: { createdAt: 'desc' },
      include: {
        user: { select: { id: true, fullName: true, email: true } },
      },
    });

    return res.status(200).json({ success: true, data: history });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message });
  }
};

module.exports = {
  getAuditLogs,
  getAuditLogById,
  getAuditHistoryByEntity,
};