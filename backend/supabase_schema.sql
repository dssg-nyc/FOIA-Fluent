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

-- ── Jurisdiction Cache ────────────────────────────────────────────────────────
-- MuckRock jurisdiction metadata for states (and optionally local).
-- Refreshed weekly by refresh_jurisdiction_stats.py.
-- No RLS: public reference data for the Data Hub.

CREATE TABLE IF NOT EXISTS jurisdiction_cache (
    id              BIGINT PRIMARY KEY,   -- MuckRock jurisdiction ID
    name            TEXT NOT NULL,
    slug            TEXT NOT NULL,
    abbrev          TEXT DEFAULT '',       -- "CA", "NY" (derived)
    level           TEXT NOT NULL DEFAULT 'state',  -- 'state' | 'local'
    parent_id       BIGINT,
    absolute_url    TEXT DEFAULT '',
    refreshed_at    TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_jurisdiction_slug ON jurisdiction_cache (slug);
CREATE INDEX IF NOT EXISTS idx_jurisdiction_level ON jurisdiction_cache (level);
CREATE INDEX IF NOT EXISTS idx_jurisdiction_parent ON jurisdiction_cache (parent_id);

-- ── Jurisdiction Stats Cache ─────────────────────────────────────────────────
-- Aggregated transparency stats per jurisdiction, computed from agencies.
-- No RLS: public reference data.

CREATE TABLE IF NOT EXISTS jurisdiction_stats_cache (
    jurisdiction_id         BIGINT PRIMARY KEY REFERENCES jurisdiction_cache(id),
    total_agencies          INT DEFAULT 0,
    total_requests          INT DEFAULT 0,
    total_completed         INT DEFAULT 0,
    total_rejected          INT DEFAULT 0,
    overall_success_rate    FLOAT DEFAULT 0,
    average_response_time   FLOAT DEFAULT 0,
    median_response_time    FLOAT DEFAULT 0,
    fee_rate                FLOAT DEFAULT 0,
    portal_coverage_pct     FLOAT DEFAULT 0,
    transparency_score      FLOAT DEFAULT 0,
    top_agency_id           BIGINT,
    top_agency_name         TEXT DEFAULT '',
    refreshed_at            TIMESTAMPTZ DEFAULT NOW()
);

-- Migration: add jurisdiction_id to agency_stats_cache for state/local agencies
-- ALTER TABLE agency_stats_cache ADD COLUMN IF NOT EXISTS jurisdiction_id BIGINT;
-- CREATE INDEX IF NOT EXISTS idx_agency_stats_jurisdiction ON agency_stats_cache (jurisdiction_id);

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

-- ── Live FOIA Signals (Phase 1) ────────────────────────────────────────────────
-- Realtime intelligence layer. Ingestion scripts in backend/app/scripts/
-- refresh_signals_*.py write to foia_signals_feed; the /api/v1/signals/* routes
-- read it; users subscribe to personas to filter.

-- Static catalog of industry personas users can subscribe to.
-- Seeded by seed_personas.py. Phase 1 ships with 4 pilot personas.
CREATE TABLE IF NOT EXISTS personas (
    id              TEXT PRIMARY KEY,             -- e.g. "journalist", "pharma_analyst"
    name            TEXT NOT NULL,                -- "Investigative Journalist"
    description     TEXT DEFAULT '',
    icon            TEXT DEFAULT '',
    display_order   INT DEFAULT 0,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

-- The aggregated signal feed — heart of the Signals system.
-- Each row is one signal from one upstream source after Claude extraction.
CREATE TABLE IF NOT EXISTS foia_signals_feed (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source          TEXT NOT NULL,                -- "gao_protests" | "epa_echo" | "fda_warning_letters" | "dhs_foia_log"
    source_id       TEXT NOT NULL,                -- upstream identifier (used for dedup)
    title           TEXT NOT NULL,
    summary         TEXT DEFAULT '',              -- AI-generated 1-2 sentence summary
    body_excerpt    TEXT DEFAULT '',              -- raw excerpt from upstream
    source_url      TEXT DEFAULT '',
    signal_date     TIMESTAMPTZ NOT NULL,         -- when the upstream event occurred
    ingested_at     TIMESTAMPTZ DEFAULT NOW(),
    agency_codes    TEXT[] DEFAULT '{}',          -- ["EPA", "DHS"]
    entities        JSONB DEFAULT '{}',           -- {companies, people, locations, regulations, dollar_amounts}
    persona_tags    TEXT[] DEFAULT '{}',          -- subset of personas.id values
    priority        INT DEFAULT 0,                -- 0=low, 1=normal, 2=high
    requester       TEXT DEFAULT '',              -- who filed the upstream FOIA request (when applicable; populated by FOIA-log sources)
    metadata        JSONB DEFAULT '{}',           -- source-specific extras
    UNIQUE (source, source_id)
);

CREATE INDEX IF NOT EXISTS idx_signals_personas ON foia_signals_feed USING GIN (persona_tags);
CREATE INDEX IF NOT EXISTS idx_signals_agencies ON foia_signals_feed USING GIN (agency_codes);
CREATE INDEX IF NOT EXISTS idx_signals_signal_date ON foia_signals_feed (signal_date DESC);
CREATE INDEX IF NOT EXISTS idx_signals_source ON foia_signals_feed (source);
CREATE INDEX IF NOT EXISTS idx_signals_requester ON foia_signals_feed (requester) WHERE requester <> '';

-- Per-user persona subscriptions. RLS-protected so users only see/modify their own.
CREATE TABLE IF NOT EXISTS user_personas (
    user_id     UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    persona_id  TEXT NOT NULL REFERENCES personas(id) ON DELETE CASCADE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (user_id, persona_id)
);

ALTER TABLE user_personas ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_personas_select" ON user_personas
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "users_own_personas_insert" ON user_personas
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users_own_personas_delete" ON user_personas
    FOR DELETE USING (auth.uid() = user_id);

-- Forward-compat watchlist table (schema only in Phase 1; UI lands in Phase 3).
CREATE TABLE IF NOT EXISTS user_watchlists (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    watchlist_type  TEXT NOT NULL,                -- "company" | "agency" | "keyword" | "zip_code"
    value           TEXT NOT NULL,
    created_at      TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE user_watchlists ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_watchlists_select" ON user_watchlists
    FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "users_own_watchlists_insert" ON user_watchlists
    FOR INSERT WITH CHECK (auth.uid() = user_id);
CREATE POLICY "users_own_watchlists_delete" ON user_watchlists
    FOR DELETE USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_user_watchlists_user_id ON user_watchlists (user_id);

-- ── Live FOIA Signals — Phase 1.5 (Entity Resolution Layer) ───────────────────
-- Adds cross-source entity joins. Click any company/agency/person/facility from
-- a signal card to see every signal across every source that mentioned them.

-- Cached AI-generated entity bios. Generated on first view, cached forever.
CREATE TABLE IF NOT EXISTS entity_bios (
    entity_type   TEXT NOT NULL,    -- "company" | "agency" | "person" | "facility"
    entity_slug   TEXT NOT NULL,    -- normalized slug, e.g. "wh-group"
    display_name  TEXT NOT NULL,    -- "WH Group"
    bio           TEXT NOT NULL,    -- 1-paragraph AI summary
    signal_count  INT DEFAULT 0,    -- denormalized count, refreshed on read
    generated_at  TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (entity_type, entity_slug)
);

-- Flat array of normalized entity slugs per signal, indexed for fast joins.
-- Format: "{type}:{slug}" e.g. "company:smithfield-foods" or "agency:epa".
ALTER TABLE foia_signals_feed
    ADD COLUMN IF NOT EXISTS entity_slugs TEXT[] DEFAULT '{}';

CREATE INDEX IF NOT EXISTS idx_signals_entity_slugs
    ON foia_signals_feed USING GIN (entity_slugs);

-- ── Live FOIA Signals — Phase 3.5 (Patterns Feed) ─────────────────────────────
-- AI-detected non-obvious cross-source patterns. Generated by a daily Claude
-- Sonnet job that reads the most recent signals and looks for concrete shared
-- entities, convergent investigations, or quantitative clusters.
-- Conservative tuning: every pattern requires a verifiable connection.
-- Manual kill-switch via the `visible` column.

CREATE TABLE IF NOT EXISTS signal_patterns (
    id                     UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    title                  TEXT NOT NULL,
    narrative              TEXT NOT NULL,             -- 2-paragraph AI explanation
    pattern_type           TEXT DEFAULT '',           -- "compounding_risk" | "coordinated_activity" | "trend_shift" | "convergence"
    signal_ids             UUID[] DEFAULT '{}',       -- foreign keys into foia_signals_feed
    entity_slugs           TEXT[] DEFAULT '{}',       -- shared entities that anchor the pattern
    persona_tags           TEXT[] DEFAULT '{}',
    non_obviousness_score  INT DEFAULT 0,             -- 0-10 from Claude
    generated_at           TIMESTAMPTZ DEFAULT NOW(),
    visible                BOOLEAN DEFAULT TRUE       -- manual kill-switch for bad patterns
);

CREATE INDEX IF NOT EXISTS idx_patterns_personas ON signal_patterns USING GIN (persona_tags);
CREATE INDEX IF NOT EXISTS idx_patterns_entities ON signal_patterns USING GIN (entity_slugs);
CREATE INDEX IF NOT EXISTS idx_patterns_generated ON signal_patterns (generated_at DESC);
CREATE INDEX IF NOT EXISTS idx_patterns_visible ON signal_patterns (visible) WHERE visible = TRUE;

-- ── Discover & Draft — Phase 3 (Saved Discoveries) ────────────────────────────
-- Persistent per-user library of documents discovered via the /draft search.
-- Each row is one document the user explicitly saved from the discovery results
-- (or directly from the search detail pane). Optionally linked back to a tracked
-- request so research and filing live next to each other.

CREATE TABLE IF NOT EXISTS discovered_documents (
    id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id         UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    -- Source data captured at save time
    source          TEXT NOT NULL,        -- "muckrock" | "documentcloud" | "web"
    source_id       TEXT,                 -- upstream identifier when available
    title           TEXT NOT NULL,
    description     TEXT DEFAULT '',
    url             TEXT NOT NULL,
    -- Optional metadata
    document_date   DATE,
    page_count      INT,
    agency          TEXT DEFAULT '',
    -- User state
    status          TEXT DEFAULT 'saved', -- "saved" | "reviewed" | "useful" | "not_useful"
    note            TEXT DEFAULT '',
    tags            TEXT[] DEFAULT '{}',
    -- Linkage
    tracked_request_id  UUID REFERENCES tracked_requests(id) ON DELETE SET NULL,
    -- Provenance
    discovered_via_query TEXT,            -- the original search query
    saved_at        TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (user_id, url)                 -- prevent duplicate saves of the same URL
);

ALTER TABLE discovered_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_discoveries" ON discovered_documents
    FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_discoveries_user ON discovered_documents (user_id);
CREATE INDEX IF NOT EXISTS idx_discoveries_status ON discovered_documents (user_id, status);
CREATE INDEX IF NOT EXISTS idx_discoveries_request ON discovered_documents (tracked_request_id);
CREATE INDEX IF NOT EXISTS idx_discoveries_tags ON discovered_documents USING GIN (tags);

-- ── Discover & Draft — Phase 4 (Saved Searches) ───────────────────────────────
-- User-saved discovery queries. The "Recent" section of the sidebar reads from
-- this table so a researcher can jump back into prior queries from anywhere.
-- Idempotent on (user_id, normalized query) — repeated saves update last_run_at
-- + last_result_count rather than creating duplicates.

CREATE TABLE IF NOT EXISTS saved_searches (
    id                 UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id            UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
    query              TEXT NOT NULL,
    interpretation     JSONB DEFAULT '{}',   -- cached AI parse for display (agency, record_types)
    name               TEXT DEFAULT '',      -- optional user-given label
    last_run_at        TIMESTAMPTZ DEFAULT NOW(),
    last_result_count  INT DEFAULT 0,
    created_at         TIMESTAMPTZ DEFAULT NOW()
);

ALTER TABLE saved_searches ENABLE ROW LEVEL SECURITY;

CREATE POLICY "users_own_saved_searches" ON saved_searches
    FOR ALL USING (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_saved_searches_user
    ON saved_searches (user_id, last_run_at DESC);

-- Cached discovery result snapshot so clicking a saved search from the sidebar
-- can hydrate instantly instead of re-running the full Claude+MuckRock+Tavily
-- discovery pipeline. The user can press "Refresh" in the UI to re-run and
-- overwrite. Nullable because older rows pre-date this column.
ALTER TABLE saved_searches
    ADD COLUMN IF NOT EXISTS result_snapshot JSONB DEFAULT NULL,
    ADD COLUMN IF NOT EXISTS snapshot_at     TIMESTAMPTZ DEFAULT NULL;
