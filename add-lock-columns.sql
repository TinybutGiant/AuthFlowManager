-- Add exclusive lock columns to guide_applications table
ALTER TABLE guide_applications ADD COLUMN IF NOT EXISTS locked_by INTEGER;
ALTER TABLE guide_applications ADD COLUMN IF NOT EXISTS locked_at TIMESTAMP WITH TIME ZONE;
ALTER TABLE guide_applications ADD COLUMN IF NOT EXISTS lock_expiry TIMESTAMP WITH TIME ZONE;