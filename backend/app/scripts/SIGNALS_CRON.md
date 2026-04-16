# Live FOIA Signals — Cron Schedule

The Live FOIA Signals ingestion scripts run as Railway scheduled jobs. Each
script is idempotent (deduped on `(source, source_id)`) so retries and overlapping
manual runs are safe.

## Schedule

| Source | Script | Cadence | Cron | Notes |
|---|---|---|---|---|
| GAO bid protests | `refresh_signals_gao` | hourly | `0 * * * *` | RSS feed updates within ~1 hour of GAO publication |
| EPA ECHO enforcement | `refresh_signals_epa_echo` | daily 06:00 ET | `0 10 * * *` | ECHO backfills weekly; daily polling catches within 24h |
| FDA Warning Letters | `refresh_signals_fda_warning_letters` | daily 07:00 ET | `0 11 * * *` | FDA posts in weekly batches, typically Tuesdays |
| DHS FOIA log (pilot) | `refresh_signals_dhs_foia_log` | weekly Mon 08:00 ET | `0 12 * * 1` | DHS publishes quarterly; weekly polling catches new files within ~7 days |

(Times in UTC are 4 hours ahead of US Eastern in winter, 5 in summer. Adjust if your Railway environment is set to a different timezone.)

## How to configure on Railway

Each script is its own Railway service (or scheduled trigger on the existing backend service, depending on your Railway plan tier).

**Option A — Railway scheduled triggers (preferred):**
1. In the Railway dashboard, open the FOIA Fluent backend service.
2. Settings → "Cron" or "Scheduled triggers".
3. Add four schedules with the cron expressions above and the corresponding `python -m app.scripts.refresh_signals_*` start command.

**Option B — Separate Railway services:**
If your plan tier doesn't support scheduled triggers on the main service, create a small companion service per script with its own start command:

```
python -m app.scripts.refresh_signals_gao
```

Set the cron expression in the service's Deploy → Cron schedule field.

## Required environment variables

Each cron service needs the same env vars as the main backend:

```
ANTHROPIC_API_KEY=...
SUPABASE_URL=...
SUPABASE_SERVICE_KEY=...
```

## Running manually for verification

After setting up the schema and seeding personas, run each script by hand to validate:

```bash
cd backend
python -m app.scripts.seed_personas
python -m app.scripts.refresh_signals_gao
python -m app.scripts.refresh_signals_epa_echo
python -m app.scripts.refresh_signals_fda_warning_letters
python -m app.scripts.refresh_signals_dhs_foia_log
```

Each script logs a one-line summary at the end:
`[gao_protests] fetched=12 inserted=8 skipped=4 failed=0 runtime=18.3s`

## Defensive design

- Every script catches per-item exceptions and continues to the next item.
- The shared `_signals_common.process_item` function handles dedup, Claude
  extraction, and upsert in one place.
- Failures during a single run never poison the table — `(source, source_id)`
  is a unique key, and unsuccessful Claude calls fall through gracefully.
- The DHS script in particular is designed to exit cleanly when no new log
  files are found upstream (which is most weeks, since DHS publishes quarterly).

## Cost ceiling (Phase 1)

Estimated monthly Claude spend across all 4 sources combined: **~$2–$5/month**
on Haiku 4.5 with the conservative tool-use prompt. Volume is small (~50–300
new signals per week across all sources). Update the cost analysis at
`docs/cost-analysis.md` once production traffic is observed.
