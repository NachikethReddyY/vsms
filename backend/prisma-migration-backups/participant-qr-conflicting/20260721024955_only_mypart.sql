-- CreateEnum
CREATE TYPE "QueueStatus" AS ENUM ('WAITING', 'IN_PROGRESS', 'COMPLETED', 'SKIPPED');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ScanResult" AS ENUM ('SUCCESS', 'INVALID', 'EXPIRED', 'REVOKED');

-- CreateEnum
CREATE TYPE "EventStatus" AS ENUM ('UPCOMING', 'ONGOING', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('REGISTERED', 'CHECKED_IN', 'CANCELLED');

-- CreateTable
CREATE TABLE "user" (
    "user_id" UUID NOT NULL,
    "full_name" VARCHAR(50) NOT NULL,
    "dob" DATE NOT NULL,
    "gender" VARCHAR(1) NOT NULL,
    "contact_number" INTEGER NOT NULL,
    "reference_number" INTEGER NOT NULL,
    "emergency_contact" INTEGER NOT NULL,
    "consent_confirmation" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "participant" (
    "participant_id" UUID NOT NULL,
    "first_name" VARCHAR(100) NOT NULL,
    "last_name" VARCHAR(100) NOT NULL,
    "date_of_birth" DATE NOT NULL,
    "gender" VARCHAR(1) NOT NULL,
    "contact_number" VARCHAR(20) NOT NULL,
    "emergency_contact" VARCHAR(20) NOT NULL,
    "consent_given" BOOLEAN NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "participant_pkey" PRIMARY KEY ("participant_id")
);

-- CreateTable
CREATE TABLE "event" (
    "event_id" UUID NOT NULL,
    "event_name" VARCHAR(100) NOT NULL,
    "location" VARCHAR(255) NOT NULL,
    "event_date" DATE NOT NULL,
    "start_time" TIME NOT NULL,
    "end_time" TIME NOT NULL,
    "status" "EventStatus" NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "event_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "event_registration" (
    "registration_id" UUID NOT NULL,
    "participant_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "queue_number" INTEGER NOT NULL,
    "registration_status" "RegistrationStatus" NOT NULL,
    "registered_by" UUID NOT NULL,
    "registered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "checked_in" BOOLEAN NOT NULL DEFAULT false,
    "checked_in_at" TIMESTAMP(3),

    CONSTRAINT "event_registration_pkey" PRIMARY KEY ("registration_id")
);

-- CreateTable
CREATE TABLE "qr_code_pass" (
    "qr_id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "token" VARCHAR(255) NOT NULL,
    "issue_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "revoked_at" TIMESTAMP(3),
    "revoked_by" UUID,
    "revoked_reason" VARCHAR(255),

    CONSTRAINT "qr_code_pass_pkey" PRIMARY KEY ("qr_id")
);

-- CreateTable
CREATE TABLE "staff_assignment" (
    "assignment_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "station_id" INTEGER NOT NULL,
    "user_id" UUID NOT NULL,
    "assigned_by" UUID NOT NULL,
    "assigned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "assignment_status" "AssignmentStatus" NOT NULL DEFAULT 'ACTIVE',

    CONSTRAINT "staff_assignment_pkey" PRIMARY KEY ("assignment_id")
);

-- CreateTable
CREATE TABLE "queue_entry" (
    "queue_id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "station_id" UUID NOT NULL,
    "queue_number" INTEGER NOT NULL,
    "status" "QueueStatus" NOT NULL,
    "entered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "called_at" TIMESTAMP(3),
    "started_at" TIMESTAMP(3),
    "left_queue_at" TIMESTAMP(3),
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "queue_entry_pkey" PRIMARY KEY ("queue_id")
);

-- CreateTable
CREATE TABLE "queue_movement" (
    "movement_id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "from_station_id" UUID NOT NULL,
    "to_station_id" UUID NOT NULL,
    "moved_by" UUID NOT NULL,
    "movement_reason" VARCHAR(100) NOT NULL,
    "movement_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "queue_movement_pkey" PRIMARY KEY ("movement_id")
);

-- CreateTable
CREATE TABLE "scan_log" (
    "scan_id" UUID NOT NULL,
    "qr_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "station_id" UUID NOT NULL,
    "scan_result" "ScanResult" NOT NULL,
    "device_name" VARCHAR(100) NOT NULL,
    "ip_address" VARCHAR(45) NOT NULL,
    "scanned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "registration_id" UUID,

    CONSTRAINT "scan_log_pkey" PRIMARY KEY ("scan_id")
);

-- CreateTable
CREATE TABLE "login_history" (
    "login_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "login_time" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "logout_time" TIMESTAMP(3),
    "login_status" TEXT NOT NULL,
    "ip_address" VARCHAR(45) NOT NULL,
    "device_name" VARCHAR(100) NOT NULL,

    CONSTRAINT "login_history_pkey" PRIMARY KEY ("login_id")
);

-- CreateTable
CREATE TABLE "audit_log" (
    "audit_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "entity_name" VARCHAR(50) NOT NULL,
    "entity_id" UUID NOT NULL,
    "old_value" JSONB,
    "new_value" JSONB,
    "ip_address" VARCHAR(45) NOT NULL,
    "device_name" VARCHAR(100) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_log_pkey" PRIMARY KEY ("audit_id")
);

-- CreateTable
CREATE TABLE "security_incident" (
    "incident_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "incident_type" VARCHAR(100) NOT NULL,
    "severity" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolved_by" UUID,
    "resolved_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "security_incident_pkey" PRIMARY KEY ("incident_id")
);

-- CreateTable
CREATE TABLE "booth" (
    "booth_id" INTEGER NOT NULL,

    CONSTRAINT "booth_pkey" PRIMARY KEY ("booth_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "qr_code_pass_registration_id_key" ON "qr_code_pass"("registration_id");

-- CreateIndex
CREATE INDEX "qr_code_pass_token_idx" ON "qr_code_pass"("token");

-- CreateIndex
CREATE INDEX "qr_code_pass_is_active_idx" ON "qr_code_pass"("is_active");

-- CreateIndex
CREATE INDEX "staff_assignment_event_id_idx" ON "staff_assignment"("event_id");

-- CreateIndex
CREATE INDEX "staff_assignment_station_id_idx" ON "staff_assignment"("station_id");

-- CreateIndex
CREATE INDEX "staff_assignment_user_id_idx" ON "staff_assignment"("user_id");

-- AddForeignKey
ALTER TABLE "event_registration" ADD CONSTRAINT "event_registration_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "participant"("participant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_registration" ADD CONSTRAINT "event_registration_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("event_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "event_registration" ADD CONSTRAINT "event_registration_registered_by_fkey" FOREIGN KEY ("registered_by") REFERENCES "user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qr_code_pass" ADD CONSTRAINT "qr_code_pass_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "event_registration"("registration_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "qr_code_pass" ADD CONSTRAINT "qr_code_pass_revoked_by_fkey" FOREIGN KEY ("revoked_by") REFERENCES "user"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_assignment" ADD CONSTRAINT "staff_assignment_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "event"("event_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_assignment" ADD CONSTRAINT "staff_assignment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "staff_assignment" ADD CONSTRAINT "staff_assignment_assigned_by_fkey" FOREIGN KEY ("assigned_by") REFERENCES "user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_entry" ADD CONSTRAINT "queue_entry_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "event_registration"("registration_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "queue_movement" ADD CONSTRAINT "queue_movement_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "event_registration"("registration_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_log" ADD CONSTRAINT "scan_log_qr_id_fkey" FOREIGN KEY ("qr_id") REFERENCES "qr_code_pass"("qr_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_log" ADD CONSTRAINT "scan_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "scan_log" ADD CONSTRAINT "scan_log_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "event_registration"("registration_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "login_history" ADD CONSTRAINT "login_history_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_log" ADD CONSTRAINT "audit_log_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_incident" ADD CONSTRAINT "security_incident_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "security_incident" ADD CONSTRAINT "security_incident_resolved_by_fkey" FOREIGN KEY ("resolved_by") REFERENCES "user"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;
