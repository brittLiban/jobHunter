-- Migration: 0006_new_job_sources
-- Adds RemoteOK and Adzuna as first-class job source kinds.

ALTER TYPE "JobSourceKind" ADD VALUE IF NOT EXISTS 'REMOTEOK';
ALTER TYPE "JobSourceKind" ADD VALUE IF NOT EXISTS 'ADZUNA';
