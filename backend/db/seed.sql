-- =====================================
-- VSMS Seed Data
-- =====================================


-- Insert Event
INSERT INTO "Event"
(
    name,
    date
)
VALUES
(
    'Community Vision Screening 2026',
    '2026-08-01'
);



-- Insert Participants
INSERT INTO "Participant"
(
    name,
    email
)
VALUES
(
    'John Tan',
    'john.tan@gmail.com'
),
(
    'Mary Lim',
    'mary.lim@gmail.com'
);



-- Insert QR Test Data
INSERT INTO "QRCode"
(
    token,
    "participantId",
    "eventId",
    "expiresAt",
    status
)
VALUES
(
    'VSMS-TEST-QR-001',
    1,
    1,
    NOW() + INTERVAL '1 hour',
    'ACTIVE'
);


-- Check inserted data

SELECT * FROM "Participant";

SELECT * FROM "Event";

SELECT * FROM "QRCode";