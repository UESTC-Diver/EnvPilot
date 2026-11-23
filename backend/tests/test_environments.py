from pathlib import Path
from typing import Iterator

from docker.errors import DockerException
from fastapi.testclient import TestClient

from app.main import app, get_docker_manager, get_store
from app.store import EnvironmentStore


class FakeDockerManager:
    def __init__(self) -> None:
        self.removed: list[str] = []
        self.stopped: list[str] = []
        self.started: list[str] = []
        self.create_error: DockerException | None = None

    def create(self, environment_id: str) -> tuple[str, str]:
        if self.create_error is not None:
            raise self.create_error
        return f"container-{environment_id}", "http://127.0.0.1:49152"

    def stop(self, container_id: str) -> None:
        self.stopped.append(container_id)

    def start(self, container_id: str, service_url: str) -> None:
        self.started.append(container_id)

    def remove(self, container_id: str) -> None:
        self.removed.append(container_id)


def client_for(tmp_path: Path) -> tuple[TestClient, FakeDockerManager]:
    manager = FakeDockerManager()

    def store_dependency() -> Iterator[EnvironmentStore]:
        yield EnvironmentStore(tmp_path / "test.db")

    def manager_dependency() -> Iterator[FakeDockerManager]:
        yield manager

    app.dependency_overrides[get_store] = store_dependency
    app.dependency_overrides[get_docker_manager] = manager_dependency
    return TestClient(app), manager


def test_environment_lifecycle_and_idempotent_destroy(tmp_path: Path) -> None:
    client, manager = client_for(tmp_path)
    try:
        created = client.post("/api/environments", json={"name": "order-test"})
        assert created.status_code == 201
        environment = created.json()
        environment_id = environment["id"]
        container_id = environment["container_id"]
        assert environment["status"] == "READY"
        assert environment["service_url"] == "http://127.0.0.1:49152"

        assert client.get(f"/api/environments/{environment_id}").json() == environment
        assert client.get("/api/environments").json() == [environment]

        stopped = client.post(f"/api/environments/{environment_id}/stop")
        assert stopped.status_code == 200
        assert stopped.json()["status"] == "STOPPED"
        assert manager.stopped == [container_id]

        started = client.post(f"/api/environments/{environment_id}/start")
        assert started.status_code == 200
        assert started.json()["status"] == "READY"
        assert manager.started == [container_id]

        destroyed = client.delete(f"/api/environments/{environment_id}")
        assert destroyed.status_code == 200
        assert destroyed.json()["status"] == "DESTROYED"
        repeated_destroy = client.delete(f"/api/environments/{environment_id}")
        assert repeated_destroy.status_code == 200
        assert repeated_destroy.json()["status"] == "DESTROYED"
        assert manager.removed == [container_id]
    finally:
        app.dependency_overrides.clear()


def test_unknown_environment_returns_not_found(tmp_path: Path) -> None:
    client, _ = client_for(tmp_path)
    try:
        response = client.get("/api/environments/missing")
        assert response.status_code == 404
        assert response.json()["detail"] == "Environment not found"
    finally:
        app.dependency_overrides.clear()


def test_docker_creation_failure_is_persisted(tmp_path: Path) -> None:
    client, manager = client_for(tmp_path)
    manager.create_error = DockerException("Docker daemon unavailable")
    try:
        response = client.post("/api/environments", json={"name": "failed-env"})
        assert response.status_code == 502
        assert "Docker daemon unavailable" in response.json()["detail"]

        environments = client.get("/api/environments").json()
        assert len(environments) == 1
        assert environments[0]["status"] == "FAILED"
        assert environments[0]["error"] == "Docker daemon unavailable"
    finally:
        app.dependency_overrides.clear()
