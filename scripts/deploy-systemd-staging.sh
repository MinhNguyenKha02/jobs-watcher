#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<EOF
Usage: $0 --host STAGING_HOST [--ssh-user SSH_USER] [--env-file PATH] [--dry-run]

Environment variables supported: STAGING_HOST, SSH_USER
Examples:
  STAGING_HOST=staging.example.com SSH_USER=deploy $0 --env-file .env.production
  $0 --host staging.example.com --ssh-user deploy --env-file .env.production --dry-run
EOF
  exit 2
}

ENV_FILE=".env.production"
DRY_RUN=0
STAGING_HOST=""
SSH_USER=""

while [ $# -gt 0 ]; do
  case "$1" in
    --env-file) ENV_FILE="$2"; shift 2 ;;
    --host|--staging-host) STAGING_HOST="$2"; shift 2 ;;
    --ssh-user) SSH_USER="$2"; shift 2 ;;
    --dry-run) DRY_RUN=1; shift ;;
    -h|--help) usage ;;
    *) echo "Unknown arg: $1"; usage ;;
  esac
done

STAGING_HOST="${STAGING_HOST:-${STAGING_HOST:-}}"
SSH_USER="${SSH_USER:-${SSH_USER:-}}"
STAGING_HOST="${STAGING_HOST:-$STAGING_HOST}"

if [ -z "$STAGING_HOST" ]; then
  echo "STAGING_HOST is required (pass --host)" >&2
  usage
fi

USER_AT_HOST="${SSH_USER:+${SSH_USER}@}${STAGING_HOST}"

SERVICE_LOCAL="scripts/systemd/jobs-watcher.service"

if [ $DRY_RUN -eq 1 ]; then
  echo "DRY RUN: would SCP $ENV_FILE and $SERVICE_LOCAL to $USER_AT_HOST:/tmp and then move into place with sudo"
  echo "scp $ENV_FILE ${USER_AT_HOST}:/tmp/jobs-watcher.env"
  echo "scp $SERVICE_LOCAL ${USER_AT_HOST}:/tmp/jobs-watcher.service"
  echo "ssh ${USER_AT_HOST} sudo mv /tmp/jobs-watcher.env /etc/jobs-watcher.env && sudo mv /tmp/jobs-watcher.service /etc/systemd/system/jobs-watcher.service && sudo systemctl daemon-reload && sudo systemctl enable --now jobs-watcher.service"
  exit 0
fi

if [ ! -f "$ENV_FILE" ]; then
  echo "Env file not found: $ENV_FILE" >&2
  exit 1
fi

echo "Copying $ENV_FILE and $SERVICE_LOCAL to ${USER_AT_HOST}:/tmp/"
scp "$ENV_FILE" "${USER_AT_HOST}:/tmp/jobs-watcher.env"
scp "$SERVICE_LOCAL" "${USER_AT_HOST}:/tmp/jobs-watcher.service"

echo "Moving files into place and enabling service on remote host"
ssh "$USER_AT_HOST" "sudo mv /tmp/jobs-watcher.env /etc/jobs-watcher.env && sudo chown root:jobswatcher /etc/jobs-watcher.env 2>/dev/null || sudo chown root:root /etc/jobs-watcher.env; sudo chmod 0640 /etc/jobs-watcher.env; sudo mv /tmp/jobs-watcher.service /etc/systemd/system/jobs-watcher.service; sudo chmod 0644 /etc/systemd/system/jobs-watcher.service; sudo systemctl daemon-reload && sudo systemctl enable --now jobs-watcher.service"

echo "Deploy finished"
