import asyncio
import logging
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import httpx

from app.config import settings
from app.routes import admin, search, draft, tracking, hub, jurisdictions, insights, chat, signals, discoveries, saved_searches

logger = logging.getLogger(__name__)

# How often the dispatcher wakes up to check "is any source due?". The actual
# per-source cadence (e.g. 24h) is enforced by the dispatcher itself based on
# each SourceConfig's `cadence_minutes`, so this tick is a cheap lookup — if
# nothing is due, we just sleep again.
SIGNALS_DISPATCH_TICK_SECONDS = 60 * 60  # 1 hour


async def _signals_dispatcher_loop():
    """Background task: every hour, run any source whose cadence has elapsed.

    Runs inside the API process so we don't need a separate Railway cron
    service. The dispatcher is self-gating via `signals_source_runs` — if this
    loop overlaps with a manual invocation, each source will still fire at
    most once per its cadence window, because `_last_run_per_source()` is
    consulted before each fetch.
    """
    from app.services.ingest.runner import run_due_sources

    # Warm-up delay so the API finishes starting before we hit Supabase
    await asyncio.sleep(30)

    while True:
        try:
            await run_due_sources()
        except asyncio.CancelledError:
            raise
        except Exception as e:
            logger.exception(f"signals dispatcher tick failed: {e}")
        await asyncio.sleep(SIGNALS_DISPATCH_TICK_SECONDS)


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.http_client = httpx.AsyncClient(
        base_url=settings.muckrock_base_url,
        timeout=30.0,
        headers={"Accept": "application/json"},
    )
    app.state.signals_task = asyncio.create_task(_signals_dispatcher_loop())
    try:
        yield
    finally:
        app.state.signals_task.cancel()
        try:
            await app.state.signals_task
        except asyncio.CancelledError:
            pass
        await app.state.http_client.aclose()


app = FastAPI(
    title="FOIA Fluent API",
    version="0.1.0",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.backend_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(search.router, prefix="/api/v1")
app.include_router(draft.router, prefix="/api/v1")
app.include_router(tracking.router, prefix="/api/v1")
app.include_router(admin.router, prefix="/api/v1")
app.include_router(hub.router, prefix="/api/v1")
app.include_router(jurisdictions.router, prefix="/api/v1")
app.include_router(insights.router, prefix="/api/v1")
app.include_router(chat.router, prefix="/api/v1")
app.include_router(signals.router, prefix="/api/v1")
app.include_router(discoveries.router, prefix="/api/v1")
app.include_router(saved_searches.router, prefix="/api/v1")


@app.get("/health")
async def health_check():
    return {"status": "ok", "version": "0.1.0"}
