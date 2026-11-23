from __future__ import annotations

import sqlite3
from contextlib import contextmanager
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterator


def _now() -> str:
    return datetime.now(UTC).isoformat()


class EnvironmentStore:
    def __init__(self, path: Path) -> None:
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self._connect() as connection:
            connection.execute(
                """
                CREATE TABLE IF NOT EXISTS environments (
                    id TEXT PRIMARY KEY,
                    name TEXT NOT NULL,
                    status TEXT NOT NULL,
                    container_id TEXT,
                    service_url TEXT,
                    error TEXT,
                    created_at TEXT NOT NULL,
                    updated_at TEXT NOT NULL
                )
                """
            )

    @contextmanager
    def _connect(self) -> Iterator[sqlite3.Connection]:
        connection = sqlite3.connect(self.path, timeout=10)
        connection.row_factory = sqlite3.Row
        try:
            with connection:
                yield connection
        finally:
            connection.close()

    def create(self, environment_id: str, name: str) -> dict[str, Any]:
        now = _now()
        with self._connect() as connection:
            connection.execute(
                """
                INSERT INTO environments (id, name, status, created_at, updated_at)
                VALUES (?, ?, 'CREATING', ?, ?)
                """,
                (environment_id, name, now, now),
            )
        environment = self.get(environment_id)
        if environment is None:
            raise RuntimeError("Created environment could not be read from storage")
        return environment

    def get(self, environment_id: str) -> dict[str, Any] | None:
        with self._connect() as connection:
            row = connection.execute(
                "SELECT * FROM environments WHERE id = ?", (environment_id,)
            ).fetchone()
        return dict(row) if row is not None else None

    def list(self) -> list[dict[str, Any]]:
        with self._connect() as connection:
            rows = connection.execute(
                "SELECT * FROM environments ORDER BY created_at DESC"
            ).fetchall()
        return [dict(row) for row in rows]

    def update(
        self,
        environment_id: str,
        *,
        status: str,
        container_id: str | None = None,
        service_url: str | None = None,
        error: str | None = None,
    ) -> dict[str, Any]:
        with self._connect() as connection:
            result = connection.execute(
                """
                UPDATE environments
                SET status = ?, container_id = COALESCE(?, container_id),
                    service_url = COALESCE(?, service_url), error = ?,
                    updated_at = ?
                WHERE id = ?
                """,
                (status, container_id, service_url, error, _now(), environment_id),
            )
        if result.rowcount == 0:
            raise LookupError(f"Environment {environment_id} does not exist")
        environment = self.get(environment_id)
        if environment is None:
            raise RuntimeError("Updated environment could not be read from storage")
        return environment
