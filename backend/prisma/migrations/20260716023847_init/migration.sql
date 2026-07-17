-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'INACTIVE', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "RoleName" AS ENUM ('ADMINISTRATOR', 'EVENT_MANAGER', 'REGISTRATION_OFFICER', 'SCREENER', 'REVIEWER');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('ACTIVE', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "RegistrationStatus" AS ENUM ('REGISTERED', 'CHECKED_IN', 'COMPLETED', 'CANCELLED');

-- CreateTable
CREATE TABLE "Role" (
    "role_id" UUID NOT NULL,
    "role_name" "RoleName" NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("role_id")
);

-- CreateTable
CREATE TABLE "User" (
    "user_id" UUID NOT NULL,
    "role_id" UUID NOT NULL,
    "department_id" UUID NOT NULL,
    "cognito_sub" UUID,
    "staff_id" VARCHAR(20) NOT NULL,
    "full_name" VARCHAR(100) NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "phone_number" VARCHAR(20),
    "profile_photo_url" VARCHAR(255),
    "account_status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "Department" (
    "department_id" UUID NOT NULL,
    "department_name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Department_pkey" PRIMARY KEY ("department_id")
);

-- CreateTable
CREATE TABLE "Gender" (
    "gender_id" UUID NOT NULL,
    "gender_name" VARCHAR(20) NOT NULL,

    CONSTRAINT "Gender_pkey" PRIMARY KEY ("gender_id")
);

-- CreateTable
CREATE TABLE "Nationality" (
    "nationality_id" UUID NOT NULL,
    "country_name" VARCHAR(100) NOT NULL,
    "country_code" CHAR(3) NOT NULL,

    CONSTRAINT "Nationality_pkey" PRIMARY KEY ("nationality_id")
);

-- CreateTable
CREATE TABLE "Participant" (
    "participant_id" UUID NOT NULL,
    "gender_id" UUID NOT NULL,
    "nationality_id" UUID NOT NULL,
    "singpass_uuid" UUID,
    "nric_fin" VARCHAR(12) NOT NULL,
    "full_name" VARCHAR(100) NOT NULL,
    "date_of_birth" DATE NOT NULL,
    "phone_number" VARCHAR(20) NOT NULL,
    "email" VARCHAR(255),
    "address" TEXT,
    "postal_code" VARCHAR(10),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Participant_pkey" PRIMARY KEY ("participant_id")
);

-- CreateTable
CREATE TABLE "Emergency_Contact" (
    "contact_id" UUID NOT NULL,
    "participant_id" UUID NOT NULL,
    "contact_name" VARCHAR(100) NOT NULL,
    "relationship" VARCHAR(50) NOT NULL,
    "phone_number" VARCHAR(20) NOT NULL,

    CONSTRAINT "Emergency_Contact_pkey" PRIMARY KEY ("contact_id")
);

-- CreateTable
CREATE TABLE "Consent" (
    "consent_id" UUID NOT NULL,
    "participant_id" UUID NOT NULL,
    "consent_given" BOOLEAN NOT NULL,
    "consent_date" TIMESTAMP(3) NOT NULL,
    "consent_version" VARCHAR(20) NOT NULL,

    CONSTRAINT "Consent_pkey" PRIMARY KEY ("consent_id")
);

-- CreateTable
CREATE TABLE "Events" (
    "event_id" UUID NOT NULL,
    "created_by" UUID NOT NULL,
    "event_name" VARCHAR(100) NOT NULL,
    "description" TEXT,
    "venue" VARCHAR(255) NOT NULL,
    "event_date" DATE NOT NULL,
    "start_time" TIME NOT NULL,
    "end_time" TIME NOT NULL,
    "capacity" INTEGER NOT NULL,
    "registered_count" INTEGER NOT NULL DEFAULT 0,
    "status" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Events_pkey" PRIMARY KEY ("event_id")
);

-- CreateTable
CREATE TABLE "Participant_Registration" (
    "registration_id" UUID NOT NULL,
    "participant_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "qr_code" VARCHAR(255),
    "registration_status" "RegistrationStatus" NOT NULL DEFAULT 'REGISTERED',
    "registered_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "checked_in_at" TIMESTAMP(3),

    CONSTRAINT "Participant_Registration_pkey" PRIMARY KEY ("registration_id")
);

-- CreateTable
CREATE TABLE "Screening_Station" (
    "station_id" UUID NOT NULL,
    "event_id" UUID NOT NULL,
    "assigned_user_id" UUID,
    "station_name" VARCHAR(100) NOT NULL,
    "station_order" INTEGER NOT NULL,
    "location" VARCHAR(100) NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Screening_Station_pkey" PRIMARY KEY ("station_id")
);

-- CreateTable
CREATE TABLE "Station_Assignment" (
    "assignment_id" UUID NOT NULL,
    "station_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "shift_start" TIMESTAMP(3) NOT NULL,
    "shift_end" TIMESTAMP(3) NOT NULL,
    "assignment_status" "AssignmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Station_Assignment_pkey" PRIMARY KEY ("assignment_id")
);

-- CreateTable
CREATE TABLE "Screening_Result" (
    "result_id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "station_id" UUID NOT NULL,
    "recorded_by" UUID NOT NULL,
    "screening_type" VARCHAR(50) NOT NULL,
    "result_data" JSONB NOT NULL,
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "remarks" TEXT,
    "sync_status" VARCHAR(20) NOT NULL DEFAULT 'SYNCED',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Screening_Result_pkey" PRIMARY KEY ("result_id")
);

-- CreateTable
CREATE TABLE "Referral" (
    "referral_id" UUID NOT NULL,
    "result_id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "reviewed_by" UUID NOT NULL,
    "referralReason" TEXT NOT NULL,
    "referred_to" VARCHAR(100) NOT NULL,
    "referral_status" VARCHAR(20) NOT NULL,
    "notes" TEXT,
    "referral_date" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Referral_pkey" PRIMARY KEY ("referral_id")
);

-- CreateTable
CREATE TABLE "Queue" (
    "queue_id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "station_id" UUID NOT NULL,
    "queue_number" VARCHAR(20) NOT NULL,
    "check_in_time" TIMESTAMP(3),
    "check_out_time" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Queue_pkey" PRIMARY KEY ("queue_id")
);

-- CreateTable
CREATE TABLE "SyncQueue" (
    "sync_id" UUID NOT NULL,
    "registration_id" UUID NOT NULL,
    "action" VARCHAR(50) NOT NULL,
    "payload" JSONB NOT NULL,
    "sync_status" VARCHAR(20) NOT NULL,
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "last_sync_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SyncQueue_pkey" PRIMARY KEY ("sync_id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "audit_id" UUID NOT NULL,
    "user_id" UUID NOT NULL,
    "action" VARCHAR(100) NOT NULL,
    "entity_name" VARCHAR(100) NOT NULL,
    "entity_id" UUID NOT NULL,
    "ip_address" VARCHAR(45),
    "user_agent" TEXT,
    "metadata" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("audit_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Role_role_name_key" ON "Role"("role_name");

-- CreateIndex
CREATE UNIQUE INDEX "User_cognito_sub_key" ON "User"("cognito_sub");

-- CreateIndex
CREATE UNIQUE INDEX "User_staff_id_key" ON "User"("staff_id");

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Department_department_name_key" ON "Department"("department_name");

-- CreateIndex
CREATE UNIQUE INDEX "Gender_gender_name_key" ON "Gender"("gender_name");

-- CreateIndex
CREATE UNIQUE INDEX "Nationality_country_name_key" ON "Nationality"("country_name");

-- CreateIndex
CREATE UNIQUE INDEX "Nationality_country_code_key" ON "Nationality"("country_code");

-- CreateIndex
CREATE UNIQUE INDEX "Participant_singpass_uuid_key" ON "Participant"("singpass_uuid");

-- CreateIndex
CREATE UNIQUE INDEX "Participant_nric_fin_key" ON "Participant"("nric_fin");

-- CreateIndex
CREATE INDEX "Participant_full_name_idx" ON "Participant"("full_name");

-- CreateIndex
CREATE INDEX "Participant_phone_number_idx" ON "Participant"("phone_number");

-- CreateIndex
CREATE UNIQUE INDEX "Participant_Registration_participant_id_event_id_key" ON "Participant_Registration"("participant_id", "event_id");

-- CreateIndex
CREATE UNIQUE INDEX "Queue_registration_id_key" ON "Queue"("registration_id");

-- CreateIndex
CREATE UNIQUE INDEX "SyncQueue_registration_id_key" ON "SyncQueue"("registration_id");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_role_id_fkey" FOREIGN KEY ("role_id") REFERENCES "Role"("role_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_department_id_fkey" FOREIGN KEY ("department_id") REFERENCES "Department"("department_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_gender_id_fkey" FOREIGN KEY ("gender_id") REFERENCES "Gender"("gender_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participant" ADD CONSTRAINT "Participant_nationality_id_fkey" FOREIGN KEY ("nationality_id") REFERENCES "Nationality"("nationality_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Emergency_Contact" ADD CONSTRAINT "Emergency_Contact_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "Participant"("participant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "Participant"("participant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Events" ADD CONSTRAINT "Events_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participant_Registration" ADD CONSTRAINT "Participant_Registration_participant_id_fkey" FOREIGN KEY ("participant_id") REFERENCES "Participant"("participant_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Participant_Registration" ADD CONSTRAINT "Participant_Registration_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "Events"("event_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Screening_Station" ADD CONSTRAINT "Screening_Station_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "Events"("event_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Screening_Station" ADD CONSTRAINT "Screening_Station_assigned_user_id_fkey" FOREIGN KEY ("assigned_user_id") REFERENCES "User"("user_id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Station_Assignment" ADD CONSTRAINT "Station_Assignment_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "Screening_Station"("station_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Station_Assignment" ADD CONSTRAINT "Station_Assignment_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Screening_Result" ADD CONSTRAINT "Screening_Result_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "Participant_Registration"("registration_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Screening_Result" ADD CONSTRAINT "Screening_Result_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "Screening_Station"("station_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Screening_Result" ADD CONSTRAINT "Screening_Result_recorded_by_fkey" FOREIGN KEY ("recorded_by") REFERENCES "User"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "User"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Referral" ADD CONSTRAINT "Referral_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "Participant_Registration"("registration_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Queue" ADD CONSTRAINT "Queue_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "Participant_Registration"("registration_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Queue" ADD CONSTRAINT "Queue_station_id_fkey" FOREIGN KEY ("station_id") REFERENCES "Screening_Station"("station_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SyncQueue" ADD CONSTRAINT "SyncQueue_registration_id_fkey" FOREIGN KEY ("registration_id") REFERENCES "Participant_Registration"("registration_id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("user_id") ON DELETE RESTRICT ON UPDATE CASCADE;
