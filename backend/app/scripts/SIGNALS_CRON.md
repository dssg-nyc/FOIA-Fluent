# Live FOIA Signals — Cron Schedule

Signals runs on a **registry-driven** pipeline. The source list lives in
[`backend/app/data/signals_sources.py`](../data/signals_sources.py); each entry
carries its own `cadence_minutes`. A single hourly Railway cron dispatches
any source whose cadence has elapsed.

## One cron entry covers every source

| Schedule | Cron expression | Command |
|---|---|---|
| hourly (top of hour) | `0 * * * *` | `python -m app.scripts.run_due_sources` |

That's it. To add a source: add a `SourceConfig` entry to the registry. No
new cron job needed; the dispatcher picks it up automatically.

### How to configure on Railway

1. Railway dashboard → backend service → Settings → Cron / Scheduled triggers.
2. Add one entry with cron `0 * * * *` and command `python -m app.scripts.run_due_sources`.
3. Required env vars: `ANTHROPIC_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`.

If you already had the 4 per-source cron entries from Phase 1 (`refresh_signals_gao`,
`refresh_signals_epa_echo`, `refresh_signals_fda_warning_letters`,
`refresh_signals_dhs_foia_log`), **delete them** once the new dispatcher is live.
They're redundant and double-writes are wasted Claude calls.

## Per-source cadence

Cadence is set on each source's `SourceConfig.cadence_minutes`. Current defaults:

| source_id | cadence | notes |
|---|---|---|
| `gao_protests` | 60 min (hourly) | RSS feeds refresh within ~1h |
| `epa_echo` | 24 h | ECHO bulk ZIP refreshes weekly; daily polling is plenty |
| `fda_warning_letters` | 24 h | FDA posts in weekly batches (Tuesdays) |
| `dhs_foia_log` | 7 d | DHS publishes quarterly; weekly check catches within ~7d |

## Running sources manually

```bash
# One specific source
python -m app.scripts.run_source --source-id gao_protests

# Ignore cadence, run now
python -m app.scripts.run_source --source-id gao_protests --force

# Fetch but don't write anything (no Claude calls, no Supabase)
python -m app.scripts.run_source --source-id gao_protests --dry-run

# Dispatch the whole registry (what the cron runs)
python -m app.scripts.run_due_sources
python -m app.scripts.run_due_sources --force   # ignore cadence
```

## Health + cost visibility

Every run writes a row to `signals_source_runs` with item counts, Claude token
usage, and status. The admin dashboard at `/admin/signals-health` (protected by
`X-Admin-Secret`) surfaces last-run status, 7-day activity, and projected
monthly cost per source.

## Defensive design

- Every source has an `enabled: bool` kill-switch. Setting `enabled=False` on a
  broken source removes it from the dispatcher until the next deploy.
- Every source has `max_items_per_run` and `max_claude_calls_per_day` caps.
- `(source, source_id)` uniqueness on `foia_signals_feed` makes retries
  idempotent — the cheap dedup check skips already-ingested items before any
  Claude call.
- Per-item failures are caught and counted but never poison the batch.

## Cost ceiling (Phase 2.1 — 4 sources)

Estimated monthly Claude spend: **~$2–$5/month** on Haiku 4.5. Phase 2.3 adds
more sources in waves toward the overall ~$75/month ceiling; the health
dashboard tracks projected monthly cost so we catch regressions early.
