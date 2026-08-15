-- AddForeignKey
ALTER TABLE "report_artifact_blobs" ADD CONSTRAINT "report_artifact_blobs_storage_key_fkey" FOREIGN KEY ("storage_key") REFERENCES "report_artifacts"("storage_key") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_station_availabilities" ADD CONSTRAINT "event_station_availabilities_event_station_id_fkey" FOREIGN KEY ("event_station_id") REFERENCES "stations"("station_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_audit_logs" ADD CONSTRAINT "event_audit_logs_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("event_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provider_event_receipts" ADD CONSTRAINT "provider_event_receipts_delivery_id_fkey" FOREIGN KEY ("delivery_id") REFERENCES "notification_deliveries"("notification_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "artifact_cleanup_tasks" ADD CONSTRAINT "artifact_cleanup_tasks_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "events"("event_id") ON DELETE RESTRICT ON UPDATE CASCADE;
