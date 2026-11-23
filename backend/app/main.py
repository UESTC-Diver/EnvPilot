from __future__ import annotations

import os
from pathlib import Path
from typing import Iterator
from uuid import uuid4

import docker
from docker.errors import DockerException, NotFound
from fastapi import Depends, FastAPI, HTTPException, status
from pydantic import BaseModel, Field
from fastapi.staticfiles import StaticFiles

from app.docker_manager import DockerManager
from app.store import EnvironmentStore

DEFAULT_DATA_DIR = Path(__file__).resolve().parents[1] / "data"
DATABASE_PATH = Path(os.getenv("ENVPILOT_DATABASE_PATH", DEFAULT_DATA_DIR / "envpilot.db"))
FRONTEND_DIST = Path(__file__).resolve().parents[1] / "frontend-dist"


class EnvironmentRequest(BaseModel):
    name: str = Field(min_length=1, max_length=80)


class EnvironmentResponse(BaseModel):
    id: str
    name: str
    status: str
    container_id: str | None
    service_url: str | None
    error: str | None
    created_at: str
    updated_at: str


def get_store() -> EnvironmentStore:
    return EnvironmentStore(DATABASE_PATH)


def get_docker_manager() -> Iterator[DockerManager]:
    try:
        client = docker.from_env()
    except DockerException as error:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail=f"Docker is unavailable: {error}",
        ) from error
    try:
        yield DockerManager(client)
    finally:
        client.close()


def _required_environment(
    store: EnvironmentStore, environment_id: str
) -> dict[str, object]:
    environment = store.get(environment_id)
    if environment is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Environment not found")
    return environment


def _docker_error(
    store: EnvironmentStore, environment_id: str, error: DockerException
) -> HTTPException:
    store.update(environment_id, status="FAILED", error=str(error))
    return HTTPException(
        status_code=status.HTTP_502_BAD_GATEWAY,
        detail=f"Docker operation failed: {error}",
    )


app = FastAPI(title="EnvPilot API", version="0.1.0")


@app.get("/api/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.post(
    "/api/environments",
    response_model=EnvironmentResponse,
    status_code=status.HTTP_201_CREATED,
)
def create_environment(
    request: EnvironmentRequest,
    store: EnvironmentStore = Depends(get_store),
    manager: DockerManager = Depends(get_docker_manager),
) -> dict[str, object]:
    environment_id = str(uuid4())
    store.create(environment_id, request.name)
    try:
        container_id, service_url = manager.create(environment_id)
    except DockerException as error:
        raise _docker_error(store, environment_id, error) from error
    return store.update(
        environment_id,
        status="READY",
        container_id=container_id,
        service_url=service_url,
    )


@app.get("/api/environments", response_model=list[EnvironmentResponse])
def list_environments(
    store: EnvironmentStore = Depends(get_store),
) -> list[dict[str, object]]:
    return store.list()


@app.get(
    "/api/environments/{environment_id}", response_model=EnvironmentResponse
)
def get_environment(
    environment_id: str,
    store: EnvironmentStore = Depends(get_store),
) -> dict[str, object]:
    return _required_environment(store, environment_id)


@app.post(
    "/api/environments/{environment_id}/stop",
    response_model=EnvironmentResponse,
)
def stop_environment(
    environment_id: str,
    store: EnvironmentStore = Depends(get_store),
    manager: DockerManager = Depends(get_docker_manager),
) -> dict[str, object]:
    environment = _required_environment(store, environment_id)
    current_status = environment["status"]
    if current_status in {"STOPPED", "DESTROYED"}:
        return environment
    if current_status != "READY":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot stop an environment in {current_status} state",
        )
    store.update(environment_id, status="STOPPING")
    try:
        manager.stop(str(environment["container_id"]))
    except DockerException as error:
        raise _docker_error(store, environment_id, error) from error
    return store.update(environment_id, status="STOPPED")


@app.post(
    "/api/environments/{environment_id}/start",
    response_model=EnvironmentResponse,
)
def start_environment(
    environment_id: str,
    store: EnvironmentStore = Depends(get_store),
    manager: DockerManager = Depends(get_docker_manager),
) -> dict[str, object]:
    environment = _required_environment(store, environment_id)
    current_status = environment["status"]
    if current_status == "READY":
        return environment
    if current_status != "STOPPED":
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=f"Cannot start an environment in {current_status} state",
        )
    store.update(environment_id, status="STARTING")
    try:
        manager.start(
            str(environment["container_id"]), str(environment["service_url"])
        )
    except DockerException as error:
        raise _docker_error(store, environment_id, error) from error
    return store.update(environment_id, status="READY")


@app.delete(
    "/api/environments/{environment_id}",
    response_model=EnvironmentResponse,
)
def destroy_environment(
    environment_id: str,
    store: EnvironmentStore = Depends(get_store),
    manager: DockerManager = Depends(get_docker_manager),
) -> dict[str, object]:
    environment = _required_environment(store, environment_id)
    if environment["status"] == "DESTROYED":
        return environment
    container_id = environment["container_id"]
    if container_id:
        try:
            manager.remove(str(container_id))
        except NotFound:
            pass
        except DockerException as error:
            raise _docker_error(store, environment_id, error) from error
    return store.update(environment_id, status="DESTROYED")


if FRONTEND_DIST.is_dir():
    app.mount("/", StaticFiles(directory=FRONTEND_DIST, html=True), name="frontend")
