-- AlterTable: add LLM provider configuration and per-user job board lists to UserPreference
ALTER TABLE "UserPreference"
ADD COLUMN "llmProvider" TEXT,
ADD COLUMN "llmModel"    TEXT,
ADD COLUMN "llmBaseUrl"  TEXT,
ADD COLUMN "llmApiKey"   TEXT,
ADD COLUMN "greenhouseBoards" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "ashbyBoards"      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "leverBoards"      TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "workableBoards"   TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
