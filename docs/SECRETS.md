# Secrets and systemd integration

This project reads runtime secrets from environment variables. For production, place key/value lines into `/etc/jobs-watcher.env` and ensure systemd loads them via `EnvironmentFile`.

Recommended fields (see `.env.production.example`):

- `INTERNAL_AUTH_TOKEN`
- `MONGODB_URI`
- `GMAIL_CLIENT_ID`
- `GMAIL_CLIENT_SECRET`
- `GMAIL_REFRESH_TOKEN`
- `WEBHOOK_PORT`
- `HEALTH_PORT`
- `START_DATA_LISTENING`
- `INGEST_SOCKET_PATH`

Systemd integration example

Create `/etc/jobs-watcher.env` with simple `KEY=VALUE` lines (no `export`).

Example unit snippet (the repository includes `scripts/systemd/jobs-watcher.service`):

```
[Service]
EnvironmentFile=/etc/jobs-watcher.env
WorkingDirectory=/srv/jobs-watcher
ExecStart=/usr/bin/node /srv/jobs-watcher/dist/index.js
```

- `/srv/jobs-watcher` is a placeholder: deploy your release artifacts there or adjust `WorkingDirectory`/`ExecStart` accordingly.

File ownership and permissions

- Owner: `root`
- Group: `jobswatcher` (create this group for tighter permissions) — fallback to `root` if not available
- Mode: `0640`

Commands to install the env file (example):

```
sudo groupadd -f jobswatcher
sudo cp ./env.production /etc/jobs-watcher.env
sudo chown root:jobswatcher /etc/jobs-watcher.env || sudo chown root:root /etc/jobs-watcher.env
sudo chmod 0640 /etc/jobs-watcher.env
```

Notes

- Keep secrets out of the repository; use `/etc` or a secret manager.
- The example service file uses `EnvironmentFile=/etc/jobs-watcher.env` to inject secrets into the unit.
