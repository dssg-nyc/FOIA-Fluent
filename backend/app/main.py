from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
import httpx

from app.config import settings
from app.routes import admin, search, draft, tracking, hub, jurisdictions


@asynccontextmanager
async def lifespan(app: FastAPI):
    app.state.http_client = httpx.AsyncClient(
        base_url=settings.muckrock_base_url,
        timeout=30.0,
        headers={"Accept": "application/json"},
    )
    yield
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


@app.get("/health")
async def health_check():
    return {"status": "ok", "version": "0.1.0"}
