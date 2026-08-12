const compareStationId = (left, right) => (
  left.stationId < right.stationId ? -1 : left.stationId > right.stationId ? 1 : 0
);

const compareRouteCandidates = (left, right) => {
  if (left.available !== right.available) return left.available ? -1 : 1;

  const leftLoad = BigInt(left.activeQueueCount) * BigInt(right.capacity);
  const rightLoad = BigInt(right.activeQueueCount) * BigInt(left.capacity);
  if (leftLoad !== rightLoad) return leftLoad < rightLoad ? -1 : 1;
  if (left.stationOrder !== right.stationOrder) return left.stationOrder - right.stationOrder;
  return compareStationId(left, right);
};

const orderRouteStations = (stations) => [...stations].sort(compareRouteCandidates);

module.exports = { compareRouteCandidates, orderRouteStations };
