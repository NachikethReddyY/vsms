-- Exact duplicate lookup for encrypted participant identifiers.
-- Nullable keeps existing records valid until they are updated through the API.
ALTER TABLE "participants"
ADD COLUMN "nric_lookup_hash" CHAR(64);

CREATE UNIQUE INDEX "participants_nric_lookup_hash_key"
ON "participants"("nric_lookup_hash");
