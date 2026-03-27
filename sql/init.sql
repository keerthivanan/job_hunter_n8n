-- Run this once in your Supabase SQL Editor
-- Creates the table that tracks all applied jobs (prevents duplicate applications)

CREATE TABLE IF NOT EXISTS applied_jobs (
  id          SERIAL PRIMARY KEY,
  job_id      TEXT UNIQUE NOT NULL,
  title       TEXT,
  company     TEXT,
  hr_email    TEXT,
  email_subject TEXT,
  status      TEXT DEFAULT 'Applied',
  applied_at  TIMESTAMP DEFAULT NOW()
);

-- Index for fast dedup lookups
CREATE INDEX IF NOT EXISTS idx_applied_jobs_job_id ON applied_jobs(job_id);
