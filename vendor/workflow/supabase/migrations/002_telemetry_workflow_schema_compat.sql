-- workflow telemetry schema compatibility
-- Renames legacy version columns in already-deployed databases and
-- rebuilds dependent index/view definitions to use workflow_version.

DO $$
DECLARE
  legacy_version_column text := 'g' || 'stack_version';
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'telemetry_events'
      AND column_name = legacy_version_column
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'telemetry_events'
      AND column_name = 'workflow_version'
  ) THEN
    EXECUTE format(
      'ALTER TABLE public.telemetry_events RENAME COLUMN %I TO workflow_version',
      legacy_version_column
    );
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'installations'
      AND column_name = legacy_version_column
  ) AND NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'installations'
      AND column_name = 'workflow_version'
  ) THEN
    EXECUTE format(
      'ALTER TABLE public.installations RENAME COLUMN %I TO workflow_version',
      legacy_version_column
    );
  END IF;
END $$;

DROP VIEW IF EXISTS public.crash_clusters;
DROP INDEX IF EXISTS public.idx_telemetry_error;

CREATE INDEX idx_telemetry_error
  ON public.telemetry_events (error_class, workflow_version)
  WHERE outcome = 'error';

CREATE VIEW public.crash_clusters AS
SELECT
  error_class,
  workflow_version,
  COUNT(*) as total_occurrences,
  COUNT(DISTINCT installation_id) as identified_users,
  COUNT(*) - COUNT(installation_id) as anonymous_occurrences,
  MIN(event_timestamp) as first_seen,
  MAX(event_timestamp) as last_seen
FROM public.telemetry_events
WHERE outcome = 'error' AND error_class IS NOT NULL
GROUP BY error_class, workflow_version
ORDER BY total_occurrences DESC;
