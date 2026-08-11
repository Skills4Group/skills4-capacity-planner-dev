from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    app_name: str = "Skills 4 Capacity Tracker API"
    environment: str = "development"
    frontend_origin: str = "http://localhost:5173"
    database_mode: str = "demo"
    azure_client_id: str | None = None
    capacity_database_host: str | None = None
    capacity_database_name: str = "capacity_tracker"
    capacity_database_user: str | None = None
    attendance_database_host: str | None = None
    attendance_database_name: str = "attendance"
    attendance_database_user: str | None = None
    forecast_months: int = 18
    auth_enabled: bool = False
    admin_object_ids: str = ""

    @property
    def admin_ids(self) -> frozenset[str]:
        return frozenset(
            value.strip().lower()
            for value in self.admin_object_ids.split(",")
            if value.strip()
        )

    model_config = SettingsConfigDict(
        env_file=".env", env_prefix="CAPACITY_", extra="ignore"
    )


@lru_cache
def get_settings() -> Settings:
    return Settings()
