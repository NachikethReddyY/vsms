-- Existing rows cannot prove their original acknowledged boolean, so replay is fail-closed until a new request records its fingerprint.
ALTER TABLE "screening_results" ADD COLUMN "request_fingerprint" CHAR(64);
