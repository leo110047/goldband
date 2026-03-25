#!/usr/bin/env bash
# Supabase project config for workflow telemetry
# These are PUBLIC keys — safe to commit (like Firebase public config).
# RLS policies restrict what the anon/publishable key can do (INSERT only).

WORKFLOW_SUPABASE_URL="https://frugpmstpnojnhfyimgv.supabase.co"
WORKFLOW_SUPABASE_ANON_KEY="sb_publishable_tR4i6cyMIrYTE3s6OyHGHw_ppx2p6WK"

# Telemetry ingest endpoint (Data API)
WORKFLOW_TELEMETRY_ENDPOINT="${WORKFLOW_SUPABASE_URL}/rest/v1"
