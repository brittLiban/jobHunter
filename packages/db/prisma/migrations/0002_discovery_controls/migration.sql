-- CreateEnum
CREATE TYPE "JobSeniorityLevel" AS ENUM ('ENTRY', 'MID', 'SENIOR');

-- AlterTable
ALTER TABLE "UserPreference"
ADD COLUMN "seniorityTargets" "JobSeniorityLevel"[] NOT NULL DEFAULT ARRAY[]::"JobSeniorityLevel"[];

-- AlterTable
ALTER TABLE "Job"
ADD COLUMN "seniorityLevel" "JobSeniorityLevel",
ADD COLUMN "seniorityConfidence" DOUBLE PRECISION,
ADD COLUMN "seniorityReason" TEXT;
