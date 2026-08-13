-- Backfill built-in stations and catalog templates that predate fieldSchemaSnapshot
-- so the dynamic screening page can open them after upgrade.

UPDATE "stations"
SET
  "field_schema_snapshot" = '[{"key":"chartDistanceMetres","label":"Chart distance (m)","type":"select","required":true,"options":["3","6"]},{"key":"od","label":"Right eye (OD)","type":"va-eye","required":true},{"key":"os","label":"Left eye (OS)","type":"va-eye","required":true},{"key":"withUsualDistanceGlasses","label":"With usual distance glasses","type":"select","required":true,"options":["yes","no","unknown"]}]'::jsonb,
  "schema_version" = COALESCE("schema_version", 1),
  "updated_at" = CURRENT_TIMESTAMP
WHERE "station_type" = 'VISUAL_ACUITY'
  AND ("field_schema_snapshot" IS NULL OR "field_schema_snapshot" = 'null'::jsonb OR "field_schema_snapshot" = '[]'::jsonb);

UPDATE "stations"
SET
  "field_schema_snapshot" = '[{"key":"measurementStatus","label":"Measurement status","type":"select","required":true,"options":["COMPLETED","UNABLE_TO_MEASURE","REPEAT_REQUIRED"]},{"key":"wearsDistanceGlasses","label":"Wears distance glasses","type":"select","required":true,"options":["yes","no","unknown"]},{"key":"od","label":"Right eye (OD)","type":"refraction-eye","required":false},{"key":"os","label":"Left eye (OS)","type":"refraction-eye","required":false},{"key":"notes","label":"Notes","type":"text","required":false}]'::jsonb,
  "schema_version" = COALESCE("schema_version", 1),
  "updated_at" = CURRENT_TIMESTAMP
WHERE "station_type" = 'REFRACTION'
  AND ("field_schema_snapshot" IS NULL OR "field_schema_snapshot" = 'null'::jsonb OR "field_schema_snapshot" = '[]'::jsonb);

UPDATE "stations"
SET
  "field_schema_snapshot" = '[{"key":"testKit","label":"Test kit","type":"select","required":true,"options":["ISHIHARA"]},{"key":"platesPresented","label":"Plates presented","type":"number","required":true,"min":8,"max":24},{"key":"odCorrect","label":"OD plates correct","type":"number","required":true,"min":0,"max":24},{"key":"osCorrect","label":"OS plates correct","type":"number","required":true,"min":0,"max":24}]'::jsonb,
  "schema_version" = COALESCE("schema_version", 1),
  "updated_at" = CURRENT_TIMESTAMP
WHERE "station_type" = 'COLOUR_VISION'
  AND ("field_schema_snapshot" IS NULL OR "field_schema_snapshot" = 'null'::jsonb OR "field_schema_snapshot" = '[]'::jsonb);

UPDATE "station_templates"
SET
  "field_schema" = '[{"key":"chartDistanceMetres","label":"Chart distance (m)","type":"select","required":true,"options":["3","6"]},{"key":"od","label":"Right eye (OD)","type":"va-eye","required":true},{"key":"os","label":"Left eye (OS)","type":"va-eye","required":true},{"key":"withUsualDistanceGlasses","label":"With usual distance glasses","type":"select","required":true,"options":["yes","no","unknown"]}]'::jsonb,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "station_type" = 'VISUAL_ACUITY'
  AND ("field_schema" IS NULL OR "field_schema" = 'null'::jsonb OR "field_schema" = '[]'::jsonb);

UPDATE "station_templates"
SET
  "field_schema" = '[{"key":"measurementStatus","label":"Measurement status","type":"select","required":true,"options":["COMPLETED","UNABLE_TO_MEASURE","REPEAT_REQUIRED"]},{"key":"wearsDistanceGlasses","label":"Wears distance glasses","type":"select","required":true,"options":["yes","no","unknown"]},{"key":"od","label":"Right eye (OD)","type":"refraction-eye","required":false},{"key":"os","label":"Left eye (OS)","type":"refraction-eye","required":false},{"key":"notes","label":"Notes","type":"text","required":false}]'::jsonb,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "station_type" = 'REFRACTION'
  AND ("field_schema" IS NULL OR "field_schema" = 'null'::jsonb OR "field_schema" = '[]'::jsonb);

UPDATE "station_templates"
SET
  "field_schema" = '[{"key":"testKit","label":"Test kit","type":"select","required":true,"options":["ISHIHARA"]},{"key":"platesPresented","label":"Plates presented","type":"number","required":true,"min":8,"max":24},{"key":"odCorrect","label":"OD plates correct","type":"number","required":true,"min":0,"max":24},{"key":"osCorrect","label":"OS plates correct","type":"number","required":true,"min":0,"max":24}]'::jsonb,
  "updated_at" = CURRENT_TIMESTAMP
WHERE "station_type" = 'COLOUR_VISION'
  AND ("field_schema" IS NULL OR "field_schema" = 'null'::jsonb OR "field_schema" = '[]'::jsonb);
