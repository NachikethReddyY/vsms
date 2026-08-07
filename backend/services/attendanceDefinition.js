const ATTENDANCE_DEFINITION = "A registration attended when it is not cancelled and checkedIn is true or checkedInAt is present.";

const attendancePredicate = Object.freeze({
  registrationStatus: { not: "CANCELLED" },
  OR: [{ checkedIn: true }, { checkedInAt: { not: null } }],
});

const attendanceWhere = (eventId) => ({ eventId, ...attendancePredicate });

const attended = (registration) => registration.registrationStatus !== "CANCELLED"
  && (registration.checkedIn === true || registration.checkedInAt != null);

module.exports = { ATTENDANCE_DEFINITION, attendancePredicate, attendanceWhere, attended };
