# Systemd units for Jobs Watcher — `/opt/jobs-watcher` isolated

Units: `jobs-watcher.service` (daemon webhook + worker) + `jobs-watcher-fetch.service/.timer` (weekly `500/7d` fetch). Least-permissive `jobs-watcher:997/1004`.

## Install

```sh
bash scripts/deploy-ci-systemd-manual-test.sh --beta # beta /opt staging no timer
bash scripts/deploy-ci-systemd-manual-test.sh        # prod /opt + timer weekly
# or directly:
bash scripts/install-systemd-local.sh .env.production
sudo systemctl daemon-reload
sudo systemctl enable --now jobs-watcher.service
sudo systemctl enable --now jobs-watcher-fetch.timer
```

## Layout

- `WorkingDirectory /opt/jobs-watcher` (`git archive HEAD →/opt`, `npm ci`, `nvm 22.12 @/opt/jobs-watcher/.nvm`, `npm run build →/opt/dist/src/index.js` `750 minh-nguyen:jobs-watcher`)
- `EnvironmentFile /etc/jobs-watcher.env` (`0640 root:jobs-watcher`)
- `ExecStart /opt/jobs-watcher/.nvm/versions/node/v22.12.0/bin/node /opt/jobs-watcher/dist/src/index.js` (`Restart=always`, `TimeoutStopSec=30`, `UMask=0027`)
- `RuntimeDirectory=jobs-watcher` `RuntimeDirectoryMode=0770` creates `/run/jobs-watcher` (`0770 jobs-watcher:jobs-watcher`) with `ingest.sock` `UDS` `WorkingDirectory` spec
- `Asset` per-job: `ASSET_OUTPUT_DIR=/srv/jobs-watcher/asset` (`0755 jobs-watcher:jobs-watcher`) `src/config:97` `ingestor.ts:112`
- `Fetch timer`: `OnCalendar=weekly Persistent RandomizedDelaySec=3600` `ExecStart=/bin/bash /opt/jobs-watcher/scripts/eval-fetch-and-trigger.sh 500 7`

## Service user

```sh
sudo groupadd -f jobs-watcher
sudo useradd --system --no-create-home --shell /usr/sbin/nologin jobs-watcher
sudo mkdir -p /run/jobs-watcher /srv/jobs-watcher/asset
sudo chown jobs-watcher:jobs-watcher /run/jobs-watcher /srv/jobs-watcher/asset
```

## Logs

- `logs/deploy/deploy-*.log` (consolidated, `install` appends `LOG_FILE` from `deploy-ci`, GH Dark `38;2` `incomplete/complete/exit`)
- `sudo journalctl -u jobs-watcher -f` + `sudo journalctl -u jobs-watcher-fetch -f`
