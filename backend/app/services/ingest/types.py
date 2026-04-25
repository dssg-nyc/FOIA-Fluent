"""Shared types for the ingest pipeline."""
from __future__ import annotations

from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Optional


@dataclass
class Extracted:
    """Already-extracted signal fields. Returned by strategies like pdf_vision
    that call Claude themselves during fetch — lets the runner skip the
    per-item Claude extraction step."""
    summary: str = ""
    entities: dict[str, Any] = field(default_factory=dict)
    persona_tags: list[str] = field(default_factory=list)
    priority: int = 0


@dataclass
class RawItem:
    """One raw signal produced by a fetch strategy, ready for extraction."""
    source_id: str
    title: str
    body_excerpt: str
    source_url: str
    signal_date: datetime
    default_agency_codes: list[str] = field(default_factory=list)
    extra_metadata: dict[str, Any] = field(default_factory=dict)
    requester: str = ""
    # If set, runner skips per-item Claude extraction and goes straight to upsert.
    pre_extracted: Optional[Extracted] = None


@dataclass
class RunResult:
    """Summary of one source run, recorded to signals_source_runs."""
    source_id: str
    status: str                  # 'succeeded' | 'failed' | 'skipped_cadence' | 'skipped_disabled'
    started_at: datetime
    completed_at: Optional[datetime] = None
    items_fetched: int = 0
    items_inserted: int = 0
    items_skipped_dup: int = 0
    items_failed: int = 0
    claude_input_tokens: int = 0
    claude_output_tokens: int = 0
    error_message: str = ""
    # Strategy-specific run-level state (e.g. pdf_vision tracks processed
    # PDF URLs here so future runs can skip them).
    metadata: dict[str, Any] = field(default_factory=dict)
