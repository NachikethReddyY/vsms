CREATE TYPE "StationOperationalStatus" AS ENUM ('AVAILABLE', 'PAUSED', 'OFFLINE');

ALTER TABLE "stations"
ADD COLUMN "operational_status" "StationOperationalStatus" NOT NULL DEFAULT 'AVAILABLE';

CREATE INDEX "stations_event_id_operational_status_station_order_idx"
ON "stations"("event_id", "operational_status", "station_order");
