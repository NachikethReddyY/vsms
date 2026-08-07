const LEGACY_STATUS = Object.freeze({
  ACTIVE: "ACTIVE",
  INACTIVE: "INACTIVE",
  SUSPENDED: "SUSPENDED",
  DISABLED: "DISABLED",
});

function deriveLegacyStatus({ approvalState, accessState, deprovisionedAt = null, inactive = false }) {
  if (deprovisionedAt || accessState === "DISABLED") return LEGACY_STATUS.DISABLED;
  if (accessState === "SUSPENDED") return LEGACY_STATUS.SUSPENDED;
  return approvalState === "APPROVED" && !inactive ? LEGACY_STATUS.ACTIVE : LEGACY_STATUS.INACTIVE;
}

module.exports = { deriveLegacyStatus };
