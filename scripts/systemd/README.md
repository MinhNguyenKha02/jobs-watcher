# Systemd unit files for Jobs Watcher

Installation
 - Copy unit files to `/etc/systemd/system/`:

```sh
sudo cp jobs-watcher-webhook.service /etc/systemd/system/
sudo cp jobs-watcher-monitor.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now jobs-watcher-webhook.service
sudo systemctl enable --now jobs-watcher-monitor.service
```

Socket permissions
 - The unit files create `/var/run/jobs-watcher` at start. Ensure the service user exists:

```sh
sudo useradd --system --no-create-home --shell /usr/sbin/nologin jobs-watcher
sudo useradd --system --no-create-home --shell /usr/sbin/nologin jobs-watcher-monitor
sudo mkdir -p /var/run/jobs-watcher
sudo chown jobs-watcher:jobs-watcher /var/run/jobs-watcher
```

Customization
 - Edit `ExecStart` to point at your deployed start script/binary.
 - Set `INTERNAL_AUTH_TOKEN`, `INTERNAL_SOCKET_PATH`, and `MONITOR_PORT` via drop-ins:

```sh
sudo systemctl edit jobs-watcher-webhook.service
```

Notes
 - Monitor service may require access to MongoDB; ensure environment variables (MONGODB_URI, MONGODB_DB_NAME) are available to the service.
 - Use `root` as `User=` only if you understand the privilege implications.
# Systemd unit files for Jobs Watcher

Installation
 - Copy unit files to `/etc/systemd/system/`:

```sh
sudo cp jobs-watcher-webhook.service /etc/systemd/system/
sudo cp jobs-watcher-monitor.service /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now jobs-watcher-webhook.service
sudo systemctl enable --now jobs-watcher-monitor.service
```

Socket permissions
 - The unit files create `/var/run/jobs-watcher` at start. Ensure the service user exists:

```sh
sudo useradd --system --no-create-home --shell /usr/sbin/nologin jobs-watcher
sudo useradd --system --no-create-home --shell /usr/sbin/nologin jobs-watcher-monitor
sudo mkdir -p /var/run/jobs-watcher
sudo chown jobs-watcher:jobs-watcher /var/run/jobs-watcher
```

Customization
 - Edit `ExecStart` to point at your deployed start script/binary.
 - Set `INTERNAL_AUTH_TOKEN`, `INTERNAL_SOCKET_PATH`, and `MONITOR_PORT` via drop-ins:

```sh
sudo systemctl edit jobs-watcher-webhook.service
```

Notes
 - Monitor service may require access to MongoDB; ensure environment variables (MONGODB_URI, MONGODB_DB_NAME) are available to the service.
 - Use `root` as `User=` only if you understand the privilege implications.
