from pydantic import field_validator
from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    muckrock_base_url: str = "https://www.muckrock.com/api_v1"
    # Accepts a JSON array or a comma-separated string:
    #   BACKEND_CORS_ORIGINS=https://app.vercel.app,http://localhost:3005
    #   BACKEND_CORS_ORIGINS=["https://app.vercel.app","http://localhost:3005"]
    backend_cors_origins: list[str] = ["http://localhost:3000", "http://localhost:3005"]

    @field_validator("backend_cors_origins", mode="before")
    @classmethod
    def parse_cors_origins(cls, v):
        if isinstance(v, str):
            v = v.strip()
            if v.startswith("["):
                import json
                return json.loads(v)
            return [o.strip() for o in v.split(",") if o.strip()]
        return v
    backend_host: str = "0.0.0.0"
    backend_port: int = 8000
    tavily_api_key: str = ""
    anthropic_api_key: str = ""
    # Supabase — optional for local dev, required for deployment
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_key: str = ""
    supabase_jwt_secret: str = ""  # Settings → API → JWT Secret (for HS256 token verification)
    # Admin endpoint protection
    admin_secret: str = ""

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
