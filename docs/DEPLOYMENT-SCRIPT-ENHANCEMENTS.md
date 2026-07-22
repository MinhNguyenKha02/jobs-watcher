# Enhanced Deployment Script: deploy-ci-systemd-manual-test.sh

**Created:** 2026-04-19  
**Purpose:** Complete CI/deployment pipeline with systemd management and artifact cleanup

## What Changed

### Script Renamed
- **Old:** `deploy-with-manual-test.sh`
- **New:** `deploy-ci-systemd-manual-test.sh`
- **Reason:** Reflects three core responsibilities: CI pipeline, systemd operations, and manual testing support

---

## New Features

### 1. Artifact Cleanup (`cleanup_artifacts()`)

**When to use:** `--clean-artifacts` flag

Removes test output before/after deployment:

- `output/`, `generated/`, `test-output/`, `coverage/` directories
- `jest-terminal-output.txt`
- `tui-logs-render.jsonl`, `tui-logs-action.jsonl`, `tui-logs-*.jsonl` files
- Ensures clean state for fresh deployments

```bash
./scripts/deploy-ci-systemd-manual-test.sh --clean-artifacts
```

---

### 1.5. Process/Port/Socket Cleanup (`cleanup_process_artifacts()`)

**When to use:** Automatically called when `--clean-artifacts` flag is used

Cleans runtime process artifacts before deployment:

- **Kills stale Node processes**: Terminates any existing `node dist/src/index` processes
- **Removes socket files**: `/run/jobs-watcher/ingest.sock`, `/run/user/$UID/jobs-watcher/ingest.sock`
- **Removes TUI state file**: `~/.cache/jobs-watcher-tui-state.json` (current job, modal state)
- **Frees ports**: Closes lingering processes on ports 3000 (webhook) and 8080 (health checks)
- **Sequencing**: Always stops daemon first, then cleans, then restarts

**Why this matters:**

- Stale sockets prevent new daemon from binding to UDS
- Lingering processes prevent socket file removal
- Old state file causes TUI to load previous job state
- Port conflicts prevent webhook endpoint from starting

```bash
./scripts/deploy-ci-systemd-manual-test.sh --clean-artifacts --skip-tests
```

This automatically:
1. Stops service
2. Cleans files (output, tui-logs-*.jsonl)
3. Kills stale processes
4. Removes sockets (/run/jobs-watcher/ingest.sock)
5. Removes state (~/.cache/jobs-watcher-tui-state.json)
6. Frees ports (3000, 8080)
7. Builds code
8. Restarts daemon fresh

---

### 2. systemd Daemon Operations

#### `systemctl_daemon_reload()`
- Runs `sudo systemctl daemon-reload`
- Called after service file updates
- Ensures systemd picks up configuration changes
- **When:** Automatically in STEP 3.5

#### `systemctl_restart_service()`
- Performs `sudo systemctl restart jobs-watcher`
- Atomic restart: stops and starts the service
- **When:** Automatically in STEP 3.5

#### `systemctl_verify_status()`
- Checks service is ACTIVE
- Scans logs for failure indicators
- Reports process status
- **When:** Automatically in STEP 3.5

---

### 3. Comprehensive Verification Checklist (`run_verification_checklist()`)

**Runs 7 automated checks:**

| # | Check | What It Tests |
|---|-------|---------------|
| 1 | Build Artifact | `dist/src/index.js` exists |
| 2 | systemd Unit | Service is registered in systemd |
| 3 | Service Status | Service is ACTIVE |
| 4 | Process | Node process running with valid PID |
| 5 | Socket File | UDS socket exists and ready |
| 6 | Environment | `.env` or config file present |
| 7 | Service Health | No recent errors in journalctl logs |

Output shows:
```
Verification Results: 7 passed, 0 failed
```

---

## Step-by-Step Flow

### Original Steps (unchanged)
1. Validate Environment
2. MongoDB Cleanup (optional)
3. Build Project
4. Install/Update systemd Service

### New Steps
- **STEP 0:** Clean Artifacts (new, optional)
- **STEP 3.5:** systemd Daemon Reload & Service Restart (new)
- **STEP 5:** Run Verification Checklist (new)
- **STEP 6:** Enhanced Summary with manual testing guide (improved)

---

## New Command-Line Options

```bash
# Artifact cleanup before deployment
./scripts/deploy-ci-systemd-manual-test.sh --clean-artifacts

# Combine with MongoDB cleanup
./scripts/deploy-ci-systemd-manual-test.sh --clean-artifacts --clean-mongodb

# Verify-only (no build, just checks)
./scripts/deploy-ci-systemd-manual-test.sh --verify-only

# Build only (no systemd operations)
./scripts/deploy-ci-systemd-manual-test.sh --build-only

# Skip tests during build
./scripts/deploy-ci-systemd-manual-test.sh --skip-tests
```

---

## Usage Examples

### Full Deployment with Cleanup
```bash
./scripts/deploy-ci-systemd-manual-test.sh --clean-artifacts --skip-tests
```
- ✅ Cleans old test output
- ✅ Skips unit tests (if you trust the build)
- ✅ Builds TypeScript
- ✅ Reloads systemd daemon
- ✅ Restarts service
- ✅ Verifies all 7 checks pass
- ✅ Shows manual testing instructions

### Production Deploy
```bash
./scripts/deploy-ci-systemd-manual-test.sh --env .env.production
```
- Uses production environment file
- Runs all tests
- Full verification checklist

### Quick Verification
```bash
./scripts/deploy-ci-systemd-manual-test.sh --verify-only
```
- Skips build
- Runs 7-point verification checklist
- Useful after manual service restarts

---

## Log Output

**Deployment Log Location:** `output/deploy-YYYYMMDD-HHMMSS.log`

Each step is logged with:
- Timestamps
- Success/failure indicators
- Command output (errors/warnings)
- Service status details

---

## systemd Integration Points

### Before Script
- You manually create/update `/etc/systemd/system/jobs-watcher.service`

### During Script (NEW)
1. **STEP 3:** Runs `install-systemd-local.sh` to copy/update service file
2. **STEP 3.5:** Runs `systemctl daemon-reload` (picks up changes)
3. **STEP 3.5:** Runs `systemctl restart jobs-watcher` (clean start)
4. **STEP 4:** Verifies service is running
5. **STEP 5:** Runs verification checklist including systemd status

### After Script
- Service is running and ready for manual testing

---

## Verification Checklist Output Example

```
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
▶ Final Verification Checklist
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
[1/7] Checking build artifact...
  ✅ Build artifact exists: dist/src/index.js
[2/7] Checking systemd unit...
  ✅ systemd unit registered
[3/7] Checking service status...
  ✅ Service is ACTIVE
[4/7] Checking process...
  ✅ Process running (PID: 2291938)
[5/7] Checking socket file...
  ✅ Socket file exists: /run/user/1000/jobs-watcher/ingest.sock
[6/7] Checking environment...
  ✅ Environment file configured
[7/7] Checking service health (last 10 logs)...
  ✅ No recent errors in logs

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
Verification Results: 7 passed, 0 failed
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
```

---

## Quick Reference: What Each Step Does

| Step | Purpose | New? |
|------|---------|------|
| 0 | Clean test artifacts | ✅ NEW |
| 1 | Validate environment | - |
| 1.5 | Clean MongoDB (optional) | - |
| 2 | Build TypeScript → dist/ | - |
| 3 | Install systemd service | - |
| **3.5** | **Reload & restart systemd** | **✅ NEW** |
| 4 | Verify daemon running | - |
| **5** | **Run verification checklist** | **✅ NEW** |
| 6 | Show summary & next steps | - |

---

## Troubleshooting

### Service won't start after restart
1. Check logs: `sudo journalctl -u jobs-watcher -n 50`
2. Verify service file: `systemctl cat jobs-watcher`
3. Re-run with `--verify-only` to diagnose

### Socket file not found
1. Check if process is running: `ps aux | grep node`
2. Look at service logs for startup errors
3. Verify socket directory has correct permissions

### Verification checklist fails on item #7
- Service is running but showing errors
- Check recent logs: `sudo journalctl -u jobs-watcher -f`
- May indicate runtime issues unrelated to deployment

---

## Related Files

- Service file: `/etc/systemd/system/jobs-watcher.service`
- Installation script: `scripts/install-systemd-local.sh`
- Old script (deprecated): `scripts/deploy-with-manual-test.sh`
- Manual testing guide: `docs/MANUAL-TUI-TESTING.md`

---

## Summary

The enhanced script **automates the complete deployment pipeline** including:
- ✅ CI testing & building
- ✅ **systemd daemon management** (reload + restart)
- ✅ **Artifact cleanup** (test outputs)
- ✅ **Comprehensive verification** (7-point checklist)
- ✅ Manual testing guidance

**Run it once after code changes, and you get a fully deployed, verified, and tested system ready for manual testing.**
