// services/eventBroker.js
const EventEmitter = require("events");
const eventEmitter = new EventEmitter();

const publishAuditLog = (auditData) => {
    // Emitting the event asynchronously so it doesn't block the HTTP response
    setImmediate(() => {
        eventEmitter.emit("AUDIT_LOG_CREATED", auditData);
    });
};

const subscribeToAuditLogs = (callback) => {
    eventEmitter.on("AUDIT_LOG_CREATED", callback);
};

module.exports = {
    publishAuditLog,
    subscribeToAuditLogs,
};