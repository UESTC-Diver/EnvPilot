# EnvPilot

EnvPilot 是面向企业研发团队的测试环境自助交付与管理平台，旨在快速创建独立、可用、可重复、可销毁的测试环境，并通过自动化测试验证平台的功能、性能、稳定性与资源管理能力。

EnvPilot is a Docker-backed test-environment manager. The V1 backend creates one
isolated nginx container per request, publishes its service on a random
`127.0.0.1` port, waits for an HTTP 200 response, and tracks its lifecycle in
SQLite.

## V1 scope

- Create, list, and inspect environments.
- Start, stop, and idempotently destroy an environment.
- Persist lifecycle state and Docker errors.
- Keep the managed workload fixed to `nginx:stable-alpine`; callers cannot submit
  arbitrary images, commands, mounts, or port bindings.
- Apply container CPU, memory, process-count, read-only-filesystem, and
  capability limits.

This is a synchronous V1 implementation. PostgreSQL, Redis/Celery, Compose-based
multi-service environments, and automatic expiry are future phases.

## Run locally

Prerequisites: Python 3.11+, Node.js 20+, and Docker Engine/Desktop running and
reachable by the current user.

Build the Vue interface once from the project root:

```powershell
cd frontend
npm install
npm run build
```

```powershell
cd ..\backend
python -m venv .venv
.\.venv\Scripts\Activate.ps1
python -m pip install -r requirements.txt
uvicorn app.main:app --reload
```

The management interface is available at `http://127.0.0.1:8000`; interactive
API docs are at `http://127.0.0.1:8000/docs`. The Vite development server can
also run with `cd frontend; npm run dev` at `http://127.0.0.1:5173`, proxying API
requests to port 8000. By default, SQLite data is stored in
`backend/data/envpilot.db`. Set `ENVPILOT_DATABASE_PATH` to choose another path.

The interface lists real environments from the API, refreshes them every 15
seconds, filters by lifecycle state or name/ID, and exposes create, start, stop,
and confirmed destroy actions. The V1 create form manages the fixed nginx test
container; it does not accept a custom image or arbitrary Docker settings.

Create an environment:

```powershell
Invoke-RestMethod -Method Post `
  -Uri http://127.0.0.1:8000/api/environments `
  -ContentType 'application/json' `
  -Body '{"name":"order-test"}'
```

Each created environment is available at its returned `service_url`. Use the
returned `id` with `GET /api/environments/{id}`, `POST /start`, `POST /stop`, and
`DELETE /api/environments/{id}`. Delete retains the lifecycle record and is safe
to repeat.

Docker must be available to create/start/stop/delete environments. Docker errors
are returned as HTTP 502 and recorded as `FAILED`; the health endpoint reports
API health only, not Docker daemon health.

## Tests

The tests use a fake Docker manager and a temporary SQLite database; they do not
require a running Docker daemon.

```powershell
cd backend
python -m pytest -q
```
