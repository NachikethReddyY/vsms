INSERT INTO "station_templates" (
  "station_template_id", "template_key", "station_type", "version", "name", "description", "default_capacity", "active", "created_at", "updated_at"
)
VALUES
  ('60000000-0000-4000-8000-000000000001', 'REGISTRATION', NULL, 1, 'Registration', 'Confirm the participant record, consent, and QR pass.', 3, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('60000000-0000-4000-8000-000000000002', 'VISUAL_ACUITY', 'VISUAL_ACUITY', 1, 'Visual acuity', 'Capture controlled distance and near-vision measurements.', 4, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('60000000-0000-4000-8000-000000000003', 'EYE_HEALTH', 'EYE_HEALTH', 1, 'Eye health', 'Record eye-health observations and screening flags.', 2, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('60000000-0000-4000-8000-000000000004', 'CLINICAL_REVIEW', NULL, 1, 'Clinical review', 'Review screening outcomes and decide the safe next step.', 2, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('60000000-0000-4000-8000-000000000005', 'REFRACTION', 'REFRACTION', 1, 'Refraction', 'Capture autorefractor SPH/CYL/Axis readings for both eyes.', 3, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP),
  ('60000000-0000-4000-8000-000000000006', 'COLOUR_VISION', 'COLOUR_VISION', 1, 'Colour vision', 'Record Ishihara plate scores for each eye.', 3, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
ON CONFLICT ("template_key") DO UPDATE SET
  "station_type" = EXCLUDED."station_type",
  "name" = EXCLUDED."name",
  "description" = EXCLUDED."description",
  "default_capacity" = EXCLUDED."default_capacity",
  "active" = true,
  "updated_at" = CURRENT_TIMESTAMP;
