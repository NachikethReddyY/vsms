ALTER TABLE "scan_logs"
  ALTER COLUMN "station_id" DROP NOT NULL;

ALTER TABLE "scan_logs"
  DROP CONSTRAINT IF EXISTS "scan_logs_station_id_fkey";

ALTER TABLE "scan_logs"
  ADD CONSTRAINT "scan_logs_station_id_fkey"
  FOREIGN KEY ("station_id") REFERENCES "stations"("station_id")
  ON DELETE SET NULL ON UPDATE CASCADE;
