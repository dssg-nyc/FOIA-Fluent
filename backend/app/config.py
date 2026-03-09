from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    muckrock_base_url: str = "https://www.muckrock.com/api_v1"
    # Comma-separated in env: BACKEND_CORS_ORIGINS=https://app.vercel.app,http://localhost:3005
    backend_cors_origins: list[str] = ["http://localhost:3000", "http://localhost:3005"]
    backend_host: str = "0.0.0.0"
    backend_port: int = 8000
    tavily_api_key: str = ""
    anthropic_api_key: str = ""
    # Supabase — optional for local dev, required for deployment
    supabase_url: str = ""
    supabase_anon_key: str = ""
    supabase_service_key: str = ""
    # Admin endpoint protection
    admin_secret: str = ""

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
