-- Migration: 0005_eeo_fields
-- Adds optional EEO (Equal Employment Opportunity) fields to UserProfile.
-- These are entirely optional and submitted voluntarily by the applicant.

ALTER TABLE "UserProfile" ADD COLUMN IF NOT EXISTS "gender"    TEXT;
ALTER TABLE "UserProfile" ADD COLUMN IF NOT EXISTS "ethnicity" TEXT;
