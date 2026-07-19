/*
  Warnings:

  - You are about to drop the `AuditLog` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Consent` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Department` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Emergency_Contact` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Events` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Gender` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Nationality` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Participant` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Participant_Registration` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Queue` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Referral` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Role` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Screening_Result` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Screening_Station` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `Station_Assignment` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `SyncQueue` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `users` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropForeignKey
ALTER TABLE "AuditLog" DROP CONSTRAINT "AuditLog_user_id_fkey";

-- DropForeignKey
ALTER TABLE "Consent" DROP CONSTRAINT "Consent_participant_id_fkey";

-- DropForeignKey
ALTER TABLE "Emergency_Contact" DROP CONSTRAINT "Emergency_Contact_participant_id_fkey";

-- DropForeignKey
ALTER TABLE "Events" DROP CONSTRAINT "Events_created_by_fkey";

-- DropForeignKey
ALTER TABLE "Participant" DROP CONSTRAINT "Participant_gender_id_fkey";

-- DropForeignKey
ALTER TABLE "Participant" DROP CONSTRAINT "Participant_nationality_id_fkey";

-- DropForeignKey
ALTER TABLE "Participant_Registration" DROP CONSTRAINT "Participant_Registration_event_id_fkey";

-- DropForeignKey
ALTER TABLE "Participant_Registration" DROP CONSTRAINT "Participant_Registration_participant_id_fkey";

-- DropForeignKey
ALTER TABLE "Queue" DROP CONSTRAINT "Queue_registration_id_fkey";

-- DropForeignKey
ALTER TABLE "Queue" DROP CONSTRAINT "Queue_station_id_fkey";

-- DropForeignKey
ALTER TABLE "Referral" DROP CONSTRAINT "Referral_registration_id_fkey";

-- DropForeignKey
ALTER TABLE "Referral" DROP CONSTRAINT "Referral_reviewed_by_fkey";

-- DropForeignKey
ALTER TABLE "Screening_Result" DROP CONSTRAINT "Screening_Result_recorded_by_fkey";

-- DropForeignKey
ALTER TABLE "Screening_Result" DROP CONSTRAINT "Screening_Result_registration_id_fkey";

-- DropForeignKey
ALTER TABLE "Screening_Result" DROP CONSTRAINT "Screening_Result_station_id_fkey";

-- DropForeignKey
ALTER TABLE "Screening_Station" DROP CONSTRAINT "Screening_Station_assigned_user_id_fkey";

-- DropForeignKey
ALTER TABLE "Screening_Station" DROP CONSTRAINT "Screening_Station_event_id_fkey";

-- DropForeignKey
ALTER TABLE "Station_Assignment" DROP CONSTRAINT "Station_Assignment_station_id_fkey";

-- DropForeignKey
ALTER TABLE "Station_Assignment" DROP CONSTRAINT "Station_Assignment_user_id_fkey";

-- DropForeignKey
ALTER TABLE "SyncQueue" DROP CONSTRAINT "SyncQueue_registration_id_fkey";

-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_department_id_fkey";

-- DropForeignKey
ALTER TABLE "users" DROP CONSTRAINT "users_role_id_fkey";

-- DropTable
DROP TABLE "AuditLog";

-- DropTable
DROP TABLE "Consent";

-- DropTable
DROP TABLE "Department";

-- DropTable
DROP TABLE "Emergency_Contact";

-- DropTable
DROP TABLE "Events";

-- DropTable
DROP TABLE "Gender";

-- DropTable
DROP TABLE "Nationality";

-- DropTable
DROP TABLE "Participant";

-- DropTable
DROP TABLE "Participant_Registration";

-- DropTable
DROP TABLE "Queue";

-- DropTable
DROP TABLE "Referral";

-- DropTable
DROP TABLE "Role";

-- DropTable
DROP TABLE "Screening_Result";

-- DropTable
DROP TABLE "Screening_Station";

-- DropTable
DROP TABLE "Station_Assignment";

-- DropTable
DROP TABLE "SyncQueue";

-- DropTable
DROP TABLE "users";

-- DropEnum
DROP TYPE "AccountStatus";

-- DropEnum
DROP TYPE "AssignmentStatus";

-- DropEnum
DROP TYPE "RegistrationStatus";

-- DropEnum
DROP TYPE "RoleName";
