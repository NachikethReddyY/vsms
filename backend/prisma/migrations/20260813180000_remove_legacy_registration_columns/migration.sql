-- Preserve legacy emergency-contact data before removing its duplicate columns.
INSERT INTO public.participant_emergency_contacts (
  emergency_contact_id,
  participant_id,
  contact_name,
  relationship,
  phone_number,
  is_primary,
  status,
  created_by,
  updated_by,
  created_at,
  updated_at
)
SELECT
  gen_random_uuid(),
  participant.participant_id,
  LEFT(COALESCE(NULLIF(BTRIM(participant.emergency_contact_name), ''), 'Emergency contact'), 120),
  'Not specified',
  participant.emergency_contact,
  TRUE,
  'ACTIVE'::public."EmergencyContactStatus",
  participant.created_by,
  participant.updated_by,
  NOW(),
  NOW()
FROM public.participants AS participant
WHERE NULLIF(BTRIM(participant.emergency_contact), '') IS NOT NULL
  AND NOT EXISTS (
    SELECT 1
    FROM public.participant_emergency_contacts AS contact
    WHERE contact.participant_id = participant.participant_id
      AND contact.status = 'ACTIVE'
  );

DROP INDEX IF EXISTS public.event_registrations_pass_token_key;

ALTER TABLE public.participants
  DROP COLUMN IF EXISTS emergency_contact,
  DROP COLUMN IF EXISTS emergency_contact_name;

ALTER TABLE public.event_registrations
  DROP COLUMN IF EXISTS pass_token;
