-- Transactional outbox for domain events. Producers insert a row in the same
-- transaction that commits the state change; the domain-event worker claims
-- rows and dispatches them to registered handlers (at-least-once delivery with
-- retry, backoff, and dead-letter semantics).

CREATE TYPE "DomainEventStatus" AS ENUM ('PENDING', 'PROCESSING', 'DISPATCHED', 'FAILED', 'DEAD_LETTER');

CREATE TABLE "domain_events" (
  "domain_event_id" UUID NOT NULL,
  "type" VARCHAR(100) NOT NULL,
  "aggregate_type" VARCHAR(50) NOT NULL,
  "aggregate_id" UUID NOT NULL,
  "correlation_id" UUID NOT NULL,
  "actor_user_id" UUID,
  "payload" JSONB NOT NULL DEFAULT '{}',
  "status" "DomainEventStatus" NOT NULL DEFAULT 'PENDING',
  "attempt_count" INTEGER NOT NULL DEFAULT 0,
  "max_attempts" INTEGER NOT NULL DEFAULT 5,
  "next_attempt_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimed_at" TIMESTAMPTZ(3),
  "claim_token" UUID,
  "last_error_code" VARCHAR(80),
  "dispatched_at" TIMESTAMPTZ(3),
  "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "domain_events_pkey" PRIMARY KEY ("domain_event_id"),
  CONSTRAINT "domain_events_actor_user_id_fkey"
    FOREIGN KEY ("actor_user_id") REFERENCES "users"("user_id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "domain_events_attempt_bounds_check"
    CHECK ("attempt_count" >= 0 AND "max_attempts" BETWEEN 1 AND 20 AND "attempt_count" <= "max_attempts"),
  CONSTRAINT "domain_events_payload_check"
    CHECK (jsonb_typeof("payload") = 'object' AND octet_length("payload"::text) <= 8192)
);
CREATE INDEX "domain_events_status_next_attempt_at_idx" ON "domain_events"("status", "next_attempt_at");
CREATE INDEX "domain_events_type_created_at_idx" ON "domain_events"("type", "created_at");
CREATE INDEX "domain_events_aggregate_type_aggregate_id_created_at_idx"
  ON "domain_events"("aggregate_type", "aggregate_id", "created_at");
CREATE INDEX "domain_events_correlation_id_idx" ON "domain_events"("correlation_id");
