from __future__ import annotations

import time
from urllib.error import URLError
from urllib.request import urlopen

import docker
from docker.errors import DockerException
from docker.models.containers import Container


class DockerManager:
    image = "nginx:stable-alpine"

    def __init__(self, client: docker.DockerClient) -> None:
        self.client = client

    def create(self, environment_id: str) -> tuple[str, str]:
        container = self.client.containers.run(
            self.image,
            detach=True,
            name=f"envpilot-{environment_id}",
            labels={"envpilot.environment_id": environment_id},
            ports={"80/tcp": ("127.0.0.1", None)},
            mem_limit="128m",
            cpu_period=100_000,
            cpu_quota=50_000,
            pids_limit=64,
            read_only=True,
            tmpfs={
                "/var/cache/nginx": "rw,noexec,nosuid,size=16m",
                "/var/run": "rw,noexec,nosuid,size=1m",
                "/tmp": "rw,noexec,nosuid,size=16m",
            },
            cap_drop=["ALL"],
            cap_add=["NET_BIND_SERVICE"],
            security_opt=["no-new-privileges:true"],
        )
        try:
            service_url = self._service_url(container)
            self._wait_until_ready(service_url)
        except DockerException:
            container.remove(force=True)
            raise
        return container.id, service_url

    def start(self, container_id: str, service_url: str) -> None:
        container = self.client.containers.get(container_id)
        container.start()
        self._wait_until_ready(service_url)

    def stop(self, container_id: str) -> None:
        self.client.containers.get(container_id).stop()

    def remove(self, container_id: str) -> None:
        self.client.containers.get(container_id).remove(force=True)

    @staticmethod
    def _service_url(container: Container) -> str:
        container.reload()
        network = container.attrs.get("NetworkSettings", {})
        ports = network.get("Ports") or {}
        bindings = ports.get("80/tcp")
        if not bindings or not bindings[0].get("HostPort"):
            raise DockerException("Docker did not publish the service port")
        return f"http://127.0.0.1:{bindings[0]['HostPort']}"

    @staticmethod
    def _wait_until_ready(service_url: str, timeout: float = 30) -> None:
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            try:
                with urlopen(service_url, timeout=1) as response:
                    if response.status == 200:
                        return
                time.sleep(0.25)
            except (URLError, TimeoutError, ConnectionError):
                time.sleep(0.25)
        raise DockerException(f"Service did not become ready at {service_url}")
