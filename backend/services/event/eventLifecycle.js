const effectiveEventStatus = (status, endsAt, now = new Date()) => {
  if (new Date(endsAt) > now || ["COMPLETED", "CANCELLED"].includes(status)) return status;
  return status === "IN_PROGRESS" ? "COMPLETED" : "CANCELLED";
};

module.exports = { effectiveEventStatus };
