const AppError = require("../../errors/AppError");

const ROUTE_OVERRIDE_REASON_CODES = [
  "STATION_UNAVAILABLE",
  "QUEUE_BALANCING",
  "PARTICIPANT_NEED",
  "EQUIPMENT_ISSUE",
  "OPERATIONAL_EXCEPTION",
];

const sameOrder = (left, right) => (
  left.length === right.length && left.every((value, index) => value === right[index])
);

const assertExactPermutation = (before, after) => {
  if (before.length !== after.length || new Set(after).size !== after.length) {
    throw new AppError(422, "INVALID_ROUTE_OVERRIDE", "The route must contain every required station exactly once.");
  }
  const required = new Set(before);
  if (after.some((stationId) => !required.has(stationId))) {
    throw new AppError(422, "INVALID_ROUTE_OVERRIDE", "The route must contain every required station exactly once.");
  }
};

/** Pure validation for full-tail and next-only route replacements. */
const validateRouteOverride = ({ steps, stationIds, activeStationId, scope }) => {
  const ordered = steps.slice().sort((left, right) => left.position - right.position);
  const before = ordered.map(({ stationId }) => stationId);
  const unfinished = ordered.filter(({ completedAt }) => !completedAt);
  const beforeUnfinished = unfinished.map(({ stationId }) => stationId);
  assertExactPermutation(beforeUnfinished, stationIds);

  const activeIndex = beforeUnfinished.indexOf(activeStationId);
  if (activeIndex >= 0 && stationIds[activeIndex] !== activeStationId) {
    throw new AppError(422, "LOCKED_ROUTE_STEP", "The currently active route step cannot be reordered.");
  }

  const mutableIndexes = beforeUnfinished
    .map((stationId, index) => ({ stationId, index }))
    .filter(({ stationId }) => stationId !== activeStationId)
    .map(({ index }) => index);
  if (!mutableIndexes.length) {
    throw new AppError(409, "ROUTE_ALREADY_COMPLETE", "There are no unfinished route steps available to replace.");
  }

  if (scope === "NEXT_ONLY") {
    const beforeMutable = mutableIndexes.map((index) => beforeUnfinished[index]);
    const afterMutable = mutableIndexes.map((index) => stationIds[index]);
    const selected = afterMutable[0];
    const allowed = [selected, ...beforeMutable.filter((stationId) => stationId !== selected)];
    if (!sameOrder(afterMutable, allowed)) {
      throw new AppError(403, "NEXT_ROUTE_STEP_ONLY", "This role may replace only the next unfinished station.");
    }
  }

  let unfinishedIndex = 0;
  const after = ordered.map((step) => (
    step.completedAt ? step.stationId : stationIds[unfinishedIndex++]
  ));
  if (sameOrder(before, after)) {
    throw new AppError(409, "ROUTE_UNCHANGED", "The proposed route has the same station order.");
  }

  return { before, after, mutableIndexes };
};

module.exports = {
  ROUTE_OVERRIDE_REASON_CODES,
  validateRouteOverride,
};
