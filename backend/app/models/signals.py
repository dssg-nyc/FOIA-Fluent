"""Pydantic models for the Live FOIA Signals system."""
from datetime import datetime
from typing import Any

from pydantic import BaseModel, Field


class Persona(BaseModel):
    id: str
    name: str
    description: str = ""
    icon: str = ""
    display_order: int = 0


class Signal(BaseModel):
    id: str
    source: str                       # "gao_protests" | "epa_echo" | ...
    source_id: str
    title: str
    summary: str = ""
    body_excerpt: str = ""
    source_url: str = ""
    signal_date: datetime
    ingested_at: datetime | None = None
    agency_codes: list[str] = Field(default_factory=list)
    entities: dict[str, Any] = Field(default_factory=dict)
    persona_tags: list[str] = Field(default_factory=list)
    priority: int = 0
    requester: str = ""
    metadata: dict[str, Any] = Field(default_factory=dict)


class SignalFeedResponse(BaseModel):
    signals: list[Signal]
    count: int
    personas_filter: list[str] = Field(default_factory=list)


class PersonaCatalogResponse(BaseModel):
    personas: list[Persona]


class UserPersonasResponse(BaseModel):
    persona_ids: list[str]


class SetUserPersonasPayload(BaseModel):
    persona_ids: list[str]
