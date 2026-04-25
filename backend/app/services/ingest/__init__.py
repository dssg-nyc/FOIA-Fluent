"""Signals ingest pipeline — registry-driven source fetching.

Entry points:
  run_source(source_id)      — fetch + extract + upsert one source
  run_due_sources()          — iterate the registry, run every source
                               whose cadence has elapsed since its last run

See backend/app/data/signals_sources.py for the registry.
"""
