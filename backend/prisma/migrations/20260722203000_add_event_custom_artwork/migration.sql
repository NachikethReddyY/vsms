ALTER TABLE "events"
ADD COLUMN "artwork_data_url" TEXT;

ALTER TABLE "events"
ADD CONSTRAINT "events_artwork_data_url_check"
CHECK (
  "artwork_data_url" IS NULL
  OR (
    char_length("artwork_data_url") <= 180000
    AND "artwork_data_url" ~ '^data:image/(jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$'
  )
);