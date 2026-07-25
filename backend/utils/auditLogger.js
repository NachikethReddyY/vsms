const { PrismaClient } = require('@prisma/client');
const prisma = new PrismaClient();

/**
 * Utility to log audit events across system controllers
 */
const logAuditEvent = async ({
  userId = null,
  action,
  entityName,
  entityId = null,
  oldValue = null,
  newValue = null,
  req = null,
}) => {
  try {
    const ipAddress = req?.ip || req?.headers['x-forwarded-for'] || '127.0.0.1';
    const deviceName = req?.headers['user-agent'] || 'Unknown Device';

    await prisma.auditLog.create({
      data: {
        userId,
        action,
        entityName,
        entityId,
        oldValue: oldValue ? JSON.parse(JSON.stringify(oldValue)) : null,
        newValue: newValue ? JSON.parse(JSON.stringify(newValue)) : null,
        ipAddress: String(ipAddress).substring(0, 45),
        deviceName: String(deviceName).substring(0, 100),
      },
    });
  } catch (error) {
    // Fail silently in production or log error so business logic isn't interrupted
    console.error('Failed to write audit log:', error);
  }
};

module.exports = { logAuditEvent };