-- Restore eye health as a configurable screening station. Existing event
-- stations remain unchanged so event managers explicitly choose where the
-- fourth station belongs in each route.

UPDATE "station_templates"
SET "station_type" = 'EYE_HEALTH',
    "active" = true,
    "description" = 'Capture eye-health observations, device findings, symptoms, and reviewer flags.',
    "field_schema" = '[
      {"key":"cataractRisk","label":"Cataract risk","type":"select","required":true,"options":["NONE","SUSPECTED","PRESENT","NOT_ASSESSED"]},
      {"key":"glaucomaRisk","label":"Glaucoma risk","type":"select","required":true,"options":["NONE","SUSPECTED","PRESENT","NOT_ASSESSED"]},
      {"key":"symptomsNoted","label":"Symptoms noted","type":"boolean","required":true},
      {"key":"symptomSummary","label":"Symptom summary","type":"text","required":false},
      {"key":"observations","label":"Observations","type":"text","required":true},
      {"key":"deviceFindings","label":"Device findings","type":"text","required":false}
    ]'::jsonb,
    "version" = GREATEST("version", 2),
    "updated_at" = CURRENT_TIMESTAMP
WHERE "template_key" = 'EYE_HEALTH';
