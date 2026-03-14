-- FOIA Fluent — Supabase Schema
-- Run this in the Supabase SQL editor before first deployment.
-- Order matters: agency_profiles and agency_intel_cache first (no user_id dependency),
-- then user-scoped tables.

-- ── Agency Profiles ────────────────────────────────────────────────────────────
-- Stores regulatory content for each federal agency.
-- Seeded from federal_agencies.py via seed_agency_profiles.py.
-- cfr_text is populated by the eCFR API fetcher in the same script.
-- No RLS: public reference data, readable by all users.

CREATE TABLE IF NOT EXISTS agency_profiles (
    abbreviation            TEXT PRIMARY KEY,
    name                    TEXT NOT NULL,
    jurisdiction            TEXT NOT NULL DEFAULT 'federal',
    description             TEXT DEFAULT '',
    foia_email              TEXT DEFAULT '',
    foia_website            TEXT DEFAULT '',
    foia_regulation         TEXT DEFAULT '',
    submission_notes        TEXT DEFAULT '',
    exemption_tendencies    TEXT DEFAULT '',
    routing_notes           TEXT DEFAULT '',
    cfr_summary             TEXT DEFAULT '',
    cfr_text                TEXT DEFAULT '',
    cfr_last_fetched        TIMESTAMPTZ,
    updated_at              TIMESTAMPTZ DEFAULT now()
);

-- ── Agency Stats Cache ─────────────────────────────────────────────────────────
-- MuckRock aggregate stats per agency, refreshed weekly by refresh_hub_stats.py.
-- No RLS: public reference data for the Data Hub.

CREATE TABLE IF NOT EXISTS agency_stats_cache (
    id                          BIGINT PRIMARY KEY,   -- MuckRock agency ID
    name                        TEXT NOT NULL,
    slug                        TEXT NOT NULL,
    jurisdiction                TEXT DEFAULT '',
    absolute_url                TEXT DEFAULT '',
    average_response_time       FLOAT DEFAULT 0,
    fee_rate                    FLOAT DEFAULT 0,
    success_rate                FLOAT DEFAULT 0,
    number_requests             INT DEFAULT 0,
    number_requests_completed   INT DEFAULT 0,
    number_requests_rejected    INT DEFAULT 0,
    number_requests_no_docs     INT DEFAULT 0,
    number_requests_ack         INT DEFAULT 0,
    number_requests_resp        INT DEFAULT 0,
    number_requests_fix         INT DEFAULT 0,
    number_requests_appeal      INT DEFAULT 0,
    number_requests_pay         INT DEFAULT 0,
    number_requests_partial     INT DEFAULT 0,
    number_requests_lawsuit     INT DEFAULT 0,
    number_requests_withdrawn   INT DEFAULT 0,
    has_portal                  BOOLEAN DEFAULT FALSE,
    transparency_score          FLOAT DEFAULT 0,      -- computed composite 0–100
    refreshed_at                TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_agency_stats_score
    ON agency_stats_cache (transparency_score DESC);
CREATE INDEX IF NOT EXISTS idx_agency_stats_slug
    ON agency_stats_cache (slug);

-- ── Agency Intel Cache ─────────────────────────────────────────────────────────
-- Dynamic MuckRock outcome data, shared across users, refreshed with 24hr TTL.
-- No RLS: shared reference data.

CREATE TABLE IF NOT EXISTS agency_intel_cache (
    agency_abbreviation     TEXT PRIMARY KEY,
    data                    JSONB NOT NULL,
    cached_at               TIMESTAMPTZ NOT NULL
);

-- ── Tracked Requests ───────────────────────────────────────────────────────────
-- One row per FOIA request tracked by a user.
-- Includes all Phase 1 + Phase 2 research context as JSONB columns.

CREATE TABLE IF NOT EXISTS tracked_requests (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                 UUID REFERENCES auth.users(id) ON DELETE CASCADE,
    title                   TEXT NOT NULL DEFAULT '',
    description             TEXT NOT NULL DEFAULT '',
    agency                  JSONB NOT NULL DEFAULT '{}',
    letter_text             TEXT NOT NULL DEFAULT '',
    requester_name          TEXT NOT NULL DEFAULT '',
    requester_organization  TEXT DEFAULT '',
    status                  TEXT NOT NULL DEFAULT 'draft',
    filed_date              DATE,
    due_date                DATE,
    created_at              TIMESTAMPTZ DEFAULT now(),
    updated_at              TIMESTAMPTZ DEFAULT now(),
    -- Research context (Phase 1 + Phase 2)
    statute_cited           TEXT DEFAULT '',
    key_elements            JSONB DEFAULT '[]',
    tips                    JSONB DEFAULT '[]',
    submission_info         TEXT DEFAULT '',
    similar_requests        JSONB DEFAULT '[]',
    drafting_strategy       JSONB DEFAULT '{}',
    agency_intel            JSONB DEFAULT '{}',
    discovery_results       JSONB DEFAULT '[]'
);

-- ── Communications ─────────────────────────────────────────────────────────────
-- Chronological log of all correspondence for a tracked request.

CREATE TABLE IF NOT EXISTS communications (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id              UUID NOT NULL REFERENCES tracked_requests(id) ON DELETE CASCADE,
    direction               TEXT NOT NULL,   -- 'outgoing' | 'incoming'
    comm_type               TEXT NOT NULL,   -- 'initial_request' | 'follow_up' | 'response' | 'appeal' | 'acknowledgment'
    subject                 TEXT DEFAULT '',
    body                    TEXT NOT NULL DEFAULT '',
    date                    DATE NOT NULL,
    created_at              TIMESTAMPTZ DEFAULT now()
);

-- ── Response Analyses ──────────────────────────────────────────────────────────
-- Claude-generated analysis of an agency response.

CREATE TABLE IF NOT EXISTS response_analyses (
    id                      UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    request_id              UUID NOT NULL REFERENCES tracked_requests(id) ON DELETE CASCADE,
    communication_id        UUID REFERENCES communications(id) ON DELETE SET NULL,  -- links analysis to the specific incoming comm
    response_complete       BOOLEAN,
    exemptions_cited        JSONB DEFAULT '[]',
    exemptions_valid        JSONB DEFAULT '[]',
    missing_records         JSONB DEFAULT '[]',
    grounds_for_appeal      JSONB DEFAULT '[]',
    recommended_action      TEXT DEFAULT '',  -- 'accept' | 'follow_up' | 'appeal' | 'negotiate_scope'
    summary                 TEXT DEFAULT '',
    analyzed_at             TIMESTAMPTZ DEFAULT now()
);

-- Migration (run if table already exists):
-- ALTER TABLE response_analyses ADD COLUMN IF NOT EXISTS communication_id UUID REFERENCES communications(id) ON DELETE SET NULL;
-- CREATE INDEX IF NOT EXISTS idx_analyses_communication_id ON response_analyses (communication_id);

-- Migration: add granular outcome columns to agency_stats_cache (run if table already exists):
-- ALTER TABLE agency_stats_cache ADD COLUMN IF NOT EXISTS number_requests_no_docs   INT DEFAULT 0;
-- ALTER TABLE agency_stats_cache ADD COLUMN IF NOT EXISTS number_requests_ack        INT DEFAULT 0;
-- ALTER TABLE agency_stats_cache ADD COLUMN IF NOT EXISTS number_requests_resp       INT DEFAULT 0;
-- ALTER TABLE agency_stats_cache ADD COLUMN IF NOT EXISTS number_requests_fix        INT DEFAULT 0;
-- ALTER TABLE agency_stats_cache ADD COLUMN IF NOT EXISTS number_requests_appeal     INT DEFAULT 0;
-- ALTER TABLE agency_stats_cache ADD COLUMN IF NOT EXISTS number_requests_pay        INT DEFAULT 0;
-- ALTER TABLE agency_stats_cache ADD COLUMN IF NOT EXISTS number_requests_partial    INT DEFAULT 0;
-- ALTER TABLE agency_stats_cache ADD COLUMN IF NOT EXISTS number_requests_lawsuit    INT DEFAULT 0;
-- ALTER TABLE agency_stats_cache ADD COLUMN IF NOT EXISTS number_requests_withdrawn  INT DEFAULT 0;

-- ── Row Level Security ─────────────────────────────────────────────────────────
-- Each user sees only their own tracked requests, communications, and analyses.

ALTER TABLE tracked_requests   ENABLE ROW LEVEL SECURITY;
ALTER TABLE communications     ENABLE ROW LEVEL SECURITY;
ALTER TABLE response_analyses  ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_requests" ON tracked_requests
    FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "users_own_communications" ON communications
    FOR ALL USING (
        request_id IN (
            SELECT id FROM tracked_requests WHERE user_id = auth.uid()
        )
    );

CREATE POLICY "users_own_analyses" ON response_analyses
    FOR ALL USING (
        request_id IN (
            SELECT id FROM tracked_requests WHERE user_id = auth.uid()
        )
    );

-- ── Indexes ────────────────────────────────────────────────────────────────────

CREATE INDEX IF NOT EXISTS idx_tracked_requests_user_id  ON tracked_requests (user_id);
CREATE INDEX IF NOT EXISTS idx_tracked_requests_status   ON tracked_requests (status);
CREATE INDEX IF NOT EXISTS idx_communications_request_id ON communications (request_id);
CREATE INDEX IF NOT EXISTS idx_analyses_request_id       ON response_analyses (request_id);
CREATE INDEX IF NOT EXISTS idx_analyses_communication_id ON response_analyses (communication_id);

-- ── updated_at trigger ─────────────────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER set_updated_at
    BEFORE UPDATE ON tracked_requests
    FOR EACH ROW EXECUTE FUNCTION update_updated_at();
