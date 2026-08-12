const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

const { orderRouteStations } = require("../../services/screening/routePolicy");

const station = (stationId, activeQueueCount, capacity, stationOrder, available = true) => ({
  stationId,
  activeQueueCount,
  capacity,
  stationOrder,
  available,
});

test("orders station load by exact fractions without rounding", () => {
  const thirds = station("station-thirds", 1, 3, 2);
  const fifths = station("station-fifths", 2, 5, 1);
  assert.deepEqual(orderRouteStations([fifths, thirds]), [thirds, fifths]);
});

test("breaks equal load ties by configured order then station id", () => {
  const route = orderRouteStations([
    station("station-c", 2, 4, 2),
    station("station-b", 1, 2, 1),
    station("station-a", 3, 6, 1),
  ]);
  assert.deepEqual(route.map(({ stationId }) => stationId), ["station-a", "station-b", "station-c"]);
});

test("defers every unavailable required station without omitting it", () => {
  const route = orderRouteStations([
    station("offline-light", 0, 5, 1, false),
    station("available-busy", 4, 5, 2),
    station("offline-busy", 3, 5, 3, false),
  ]);
  assert.deepEqual(route.map(({ stationId }) => stationId), [
    "available-busy",
    "offline-light",
    "offline-busy",
  ]);
});

test("does not mutate configured station input", () => {
  const configured = [station("later", 1, 1, 2), station("first", 0, 1, 1)];
  orderRouteStations(configured);
  assert.deepEqual(configured.map(({ stationId }) => stationId), ["later", "first"]);
});

test("schema and migration enforce normalized route and active-queue invariants", () => {
  const schema = fs.readFileSync(path.join(__dirname, "../../prisma/schema.prisma"), "utf8");
  const migration = fs.readFileSync(path.join(
    __dirname,
    "../../prisma/migrations/20260812200000_add_registration_routes/migration.sql",
  ), "utf8");
  assert.match(schema, /routeVersion\s+Int\s+@default\(1\)/);
  assert.match(schema, /model RegistrationRouteStep/);
  assert.match(schema, /@@unique\(\[registrationId, position\]\)/);
  assert.match(schema, /@@unique\(\[registrationId, stationId\]\)/);
  assert.match(migration, /CHECK \("position" > 0\)/);
  assert.match(migration, /CREATE UNIQUE INDEX "queue_entries_one_active_registration_key"[\s\S]*WHERE "status" IN \('WAITING', 'CALLED', 'IN_PROGRESS'\)/);
});
