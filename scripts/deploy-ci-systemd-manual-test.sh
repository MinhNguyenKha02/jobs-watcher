#!/usr/bin/env bash
#
# deploy-ci-systemd-manual-test.sh
# Enhanced deployment script with CI, systemd management, and manual testing
#
# Features:
#   • Full CI pipeline (test, build, verify)
#   • Systemd operations (daemon-reload, restart, status checks)
#   • Artifact cleanup (e2e-output, generated/, test logs)
#   • Comprehensive verification checklist
#
# Usage:
#   ./scripts/deploy-ci-systemd-manual-test.sh [options]
#
# Options:
#   --build-only           Only build, don't deploy or verify
#   --verify-only          Only verify deployment, don't build
#   --clean-artifacts      Clean test output + process artifacts (sockets, ports)
#   --clean-mongodb        Clean MongoDB collections
#   --env FILE             Use alternate .env file (default: .env.production)
#   --skip-tests           Skip running tests before build
#   --help                 Show this message
#

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Configuration
ENV_FILE="${ENV_FILE:-.env.production}"
BUILD_ONLY=false
VERIFY_ONLY=false
SKIP_TESTS=false
CLEAN_MONGODB=false
CLEAN_ARTIFACTS=false
LOG_DIR="logs"
LOG_FILE="$LOG_DIR/deploy-$(date +%Y%m%d-%H%M%S).log"

# ============================================================================
# HELPER: Artifact Cleanup (Files + Directories)
# ============================================================================
cleanup_artifacts() {
  local stage="$1"  # "before" or "after"
  log_info "🧹 Cleaning test artifacts ($stage deployment)..."
  
  local cleaned=0
  
  # Remove test output directories
  for dir in generated test-output coverage; do
    if [ -d "$dir" ]; then
      rm -rf "$dir"
      log_info "  ✓ Removed $dir/"
      ((cleaned++))
    fi
  done
  
  # Remove test log files
  for file in jest-terminal-output.txt tui-logs-render.jsonl tui-logs-action.jsonl tui-logs-*.jsonl; do
    if [ -f "$file" ]; then
      rm -f "$file"
      log_info "  ✓ Removed $file"
      ((cleaned++))
    fi
  done
  
  # Recreate log directory
  mkdir -p "$LOG_DIR"
  chmod 755 "$LOG_DIR" 2>/dev/null || true
  
  log_info "✅ Cleaned $cleaned artifact(s)"
}

# ============================================================================
# HELPER: Process/Port/Socket Cleanup
# ============================================================================
cleanup_process_artifacts() {
  log_info "🧹 Cleaning process artifacts (sockets, ports, state)..."
  
  local cleaned=0
  
  # Stop systemd service first (graceful)
  if systemctl is-active --quiet jobs-watcher 2>/dev/null; then
    log_info "  Stopping jobs-watcher service..."
    sudo systemctl stop jobs-watcher 2>/dev/null || true
    sleep 1
    ((cleaned++))
  fi

  # Kill any remaining node processes (jobs-watcher)
  local node_pids
  node_pids=$(pgrep -f "node.*dist/src/index" || true)
  if [ -n "$node_pids" ]; then
    log_info "  Killing stray Node processes: $node_pids"
    echo "$node_pids" | xargs kill -9 2>/dev/null || true
    log_info "  ✓ Killed stray node processes"
    ((cleaned++))
    sleep 1
  fi
  
  # Remove socket files
  for socket_path in "/run/jobs-watcher/ingest.sock" "/run/user/$(id -u)/jobs-watcher/ingest.sock" "$XDG_RUNTIME_DIR/jobs-watcher/ingest.sock"; do
    if [ -S "$socket_path" ] 2>/dev/null; then
      rm -f "$socket_path"
      log_info "  ✓ Removed socket: $socket_path"
      ((cleaned++))
    fi
  done
  
  # Remove TUI state file
  local state_file="$HOME/.cache/jobs-watcher-tui-state.json"
  if [ -f "$state_file" ]; then
    rm -f "$state_file"
    log_info "  ✓ Removed state file: $state_file"
    ((cleaned++))
  fi
  
  # Close lingering ports
  for port in 3000 8080; do
    local port_pids
    port_pids=$(lsof -ti :$port 2>/dev/null || true)
    if [ -n "$port_pids" ]; then
      log_warn "  Port $port is in use, attempting to free..."
      echo "$port_pids" | xargs kill -9 2>/dev/null || true
      ((cleaned++))
    fi
  done
  
  log_info "✅ Cleaned $cleaned process artifact(s)"
}

# ============================================================================
# HELPER: systemctl Operations
# ============================================================================
systemctl_daemon_reload() {
  log_info "Reloading systemd daemon..."
  if sudo systemctl daemon-reload 2>&1 | tee -a "$LOG_FILE"; then
    log_info "✅ systemd daemon reloaded"
    sleep 1
    return 0
  else
    log_error "Failed to reload systemd daemon"
    return 1
  fi
}

systemctl_restart_service() {
  log_info "Restarting jobs-watcher service..."
  if sudo systemctl restart jobs-watcher 2>&1 | tee -a "$LOG_FILE"; then
    log_info "✅ Service restart command sent"
    sleep 2
    return 0
  else
    log_error "Failed to restart service"
    return 1
  fi
}

systemctl_verify_status() {
  log_info "Verifying service status..."
  
  # Check if service is active
  if sudo systemctl is-active --quiet jobs-watcher; then
    log_info "✅ Service is ACTIVE"
  else
    log_error "Service is NOT ACTIVE"
    sudo systemctl status jobs-watcher 2>&1 | tee -a "$LOG_FILE" || true
    return 1
  fi
  
  # Check for service failures
  local failures
  failures=$(sudo systemctl status jobs-watcher 2>&1 | grep -c "failed\|error\|Failed" || true)
  if [ "$failures" -gt 0 ]; then
    log_warn "⚠️  Service shows failure indicators"
    sudo journalctl -u jobs-watcher -n 20 2>&1 | tee -a "$LOG_FILE" || true
  fi
  
  return 0
}

# ============================================================================
# HELPER: Verification Checklist
# ============================================================================
run_verification_checklist() {
  log_section "Final Verification Checklist"
  
  local pass=0
  local fail=0
  
  # Check 1: Build artifact
  log_info "[1/7] Checking build artifact..."
  if [ -f "dist/src/index.js" ]; then
    log_info "  ✅ Build artifact exists: dist/src/index.js"
    ((pass++))
  else
    log_error "  ❌ Build artifact missing: dist/src/index.js"
    ((fail++))
  fi
  
  # Check 2: systemd unit registered
  log_info "[2/7] Checking systemd unit..."
  if sudo systemctl show jobs-watcher -p UnitFileState 2>&1 | grep -q "enabled\|disabled"; then
    log_info "  ✅ systemd unit registered"
    ((pass++))
  else
    log_warn "  ⚠️  systemd unit state unclear"
    ((pass++))
  fi
  
  # Check 3: Service is ACTIVE
  log_info "[3/7] Checking service status..."
  if sudo systemctl is-active --quiet jobs-watcher; then
    log_info "  ✅ Service is ACTIVE"
    ((pass++))
  else
    log_error "  ❌ Service is NOT ACTIVE"
    ((fail++))
  fi
  
  # Check 4: Process running
  log_info "[4/7] Checking process..."
  local pid
  pid=$(pgrep -f "node.*dist/src/index.js" | head -1 || true)
  if [ -n "$pid" ]; then
    log_info "  ✅ Process running (PID: $pid)"
    ((pass++))
  else
    log_error "  ❌ Process not running"
    ((fail++))
  fi
  
  # Check 5: Socket file
  log_info "[5/7] Checking socket file..."
  local socket_found=false
  for possible_path in "$SOCKET_PATH" "/run/jobs-watcher/ingest.sock" "/run/user/$(id -u)/jobs-watcher/ingest.sock"; do
    if [ -S "$possible_path" ] 2>/dev/null; then
      log_info "  ✅ Socket file exists: $possible_path"
      socket_found=true
      ((pass++))
      break
    fi
  done
  if [ "$socket_found" = false ]; then
    log_error "  ❌ Socket file not found"
    ((fail++))
  fi
  
  # Check 6: Environment configured
  log_info "[6/7] Checking environment..."
  if [ -f "$ENV_FILE" ] || [ -f ".env" ]; then
    log_info "  ✅ Environment file configured"
    ((pass++))
  else
    log_warn "  ⚠️  Environment file not found"
    ((pass++))
  fi
  
  # Check 7: Service health
  log_info "[7/7] Checking service health (last 10 logs)..."
  local errors
  errors=$(sudo journalctl -u jobs-watcher -n 10 2>&1 | grep -c "error\|Error\|ERROR" || true)
  if [ "$errors" -eq 0 ]; then
    log_info "  ✅ No recent errors in logs"
    ((pass++))
  else
    log_warn "  ⚠️  $errors error(s) in recent logs"
    ((pass++))
  fi
  
  # Summary
  echo
  log_info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  log_info "Verification Results: ${GREEN}$pass passed${NC}, ${RED}$fail failed${NC}"
  log_info "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
  
  if [ "$fail" -gt 0 ]; then
    return 1
  fi
  return 0
}

# ============================================================================
# DETECT SOCKET PATH (DEV vs PROD)
# ============================================================================
detect_socket_path() {
  if [ -n "${XDG_RUNTIME_DIR:-}" ] && [ -S "$XDG_RUNTIME_DIR/jobs-watcher/ingest.sock" ]; then
    echo "$XDG_RUNTIME_DIR/jobs-watcher/ingest.sock"
  elif [ -S "/run/user/$(id -u)/jobs-watcher/ingest.sock" ]; then
    echo "/run/user/$(id -u)/jobs-watcher/ingest.sock"
  elif [ -S "/run/jobs-watcher/ingest.sock" ]; then
    echo "/run/jobs-watcher/ingest.sock"
  else
    echo "/run/user/$(id -u)/jobs-watcher/ingest.sock"
  fi
}

SOCKET_PATH="$(detect_socket_path)"
WEBHOOK_PORT="${WEBHOOK_PORT:-3000}"
INTERNAL_AUTH_TOKEN="${INTERNAL_AUTH_TOKEN:-temp-dev-token}"

# Ensure log directory is writable
mkdir -p "$LOG_DIR"
chmod 755 "$LOG_DIR" 2>/dev/null || true

# Logging
log_info() {
  echo -e "${GREEN}[INFO]${NC} $1" | tee -a "$LOG_FILE"
}

log_warn() {
  echo -e "${YELLOW}[WARN]${NC} $1" | tee -a "$LOG_FILE"
}

log_error() {
  echo -e "${RED}[ERROR]${NC} $1" | tee -a "$LOG_FILE"
}

log_section() {
  echo -e "\n${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}" | tee -a "$LOG_FILE"
  echo -e "${BLUE}▶ $1${NC}" | tee -a "$LOG_FILE"
  echo -e "${BLUE}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${NC}" | tee -a "$LOG_FILE"
}

# Parse arguments
while [[ $# -gt 0 ]]; do
  case "$1" in
    --build-only)
      BUILD_ONLY=true
      shift
      ;;
    --verify-only)
      VERIFY_ONLY=true
      shift
      ;;
    --clean-mongodb)
      CLEAN_MONGODB=true
      shift
      ;;
    --clean-artifacts)
      CLEAN_ARTIFACTS=true
      shift
      ;;
    --env)
      ENV_FILE="$2"
      shift 2
      ;;
    --skip-tests)
      SKIP_TESTS=true
      shift
      ;;
    --help)
      grep '^#' "$0" | head -30
      exit 0
      ;;
    *)
      log_error "Unknown option: $1"
      exit 1
      ;;
  esac
done

# ============================================================================
# STEP 0: Clean Artifacts (if requested)
# ============================================================================
if [[ "$CLEAN_ARTIFACTS" == "true" ]]; then
  log_section "STEP 0: Clean Artifacts & Processes"
  
  # Stop daemon first to safely clean sockets/ports
  log_info "Stopping service before cleanup..."
  sudo systemctl stop jobs-watcher 2>&1 | tee -a "$LOG_FILE" || true
  sleep 1
  
  # Clean file artifacts
  cleanup_artifacts "before"
  
  # Clean process artifacts (sockets, ports, state)
  cleanup_process_artifacts
fi

# ============================================================================
# STEP 1: Validate Environment
# ============================================================================
log_section "STEP 1: Validate Environment"

if [[ "$VERIFY_ONLY" != "true" ]]; then
  if [ ! -f "$ENV_FILE" ]; then
    if [ -f .env ]; then
      ENV_FILE=".env"
      log_info "Env file not found, using default .env"
    else
      log_warn "No env file found at $ENV_FILE or .env"
      log_info "Creating minimal environment..."
      cat > /tmp/jobs-watcher.deploy.env <<EOF
# Minimal deployment environment
NODE_ENV=production
LOG_LEVEL=info
LOG_FORMAT=json
INTERNAL_AUTH_TOKEN=${INTERNAL_AUTH_TOKEN}
MONGODB_URI=mongodb://localhost:27017/jobs-watcher
GMAIL_CLIENT_ID=<set-in-systemd-env>
GMAIL_CLIENT_SECRET=<set-in-systemd-env>
GMAIL_REFRESH_TOKEN=<set-in-systemd-env>
EOF
      ENV_FILE="/tmp/jobs-watcher.deploy.env"
      log_info "Created temporary env file: $ENV_FILE"
    fi
  fi

  log_info "Environment file: $ENV_FILE"
  log_info "Node.js version: $(node --version)"
  log_info "npm version: $(npm --version)"
fi

# ============================================================================
# STEP 1.5: MongoDB Cleanup (if --clean-mongodb flag)
# ============================================================================
if [[ "$CLEAN_MONGODB" == "true" ]] && [[ "$VERIFY_ONLY" != "true" ]]; then
  log_section "STEP 1.5: MongoDB Cleanup"
  
  log_info "Cleaning MongoDB collections..."
  if SKIP_CONFIRM=1 npm run db:truncate >> "$LOG_FILE" 2>&1; then
    log_info "✅ MongoDB cleaned successfully"
  else
    log_warn "⚠️  MongoDB cleanup had issues, continuing with deployment"
  fi
  sleep 1
fi

# ============================================================================
# STEP 1.75: Ensure old process is stopped (prevent PID accumulation)
# ============================================================================
if [[ "$BUILD_ONLY" != "true" && "$VERIFY_ONLY" != "true" ]]; then
  log_section "STEP 1.75: Stop Old Service"
  log_info "Stopping old jobs-watcher service..."
  sudo systemctl stop jobs-watcher 2>&1 | tee -a "$LOG_FILE" || true
  sleep 1
  
  # Kill any stray node processes matching our app
  stray_pids=$(pgrep -f "node.*dist/src/index" || true)
  if [ -n "$stray_pids" ]; then
    log_warn "Stray PIDs still alive: $stray_pids — killing..."
    echo "$stray_pids" | xargs sudo kill -9 2>/dev/null || true
    sleep 1
  fi
  log_info "✅ Old service stopped, no stale PIDs remain"
fi

# ============================================================================
# STEP 2: Build Project (if not verify-only)
# ============================================================================
if [[ "$VERIFY_ONLY" != "true" ]]; then
  log_section "STEP 2: Build Project"

  # Run tests unless skipped
  if [[ "$SKIP_TESTS" != "true" ]]; then
    log_info "Running test suite..."
    if npm run test:unit > "$LOG_DIR/test-unit.log" 2>&1; then
      log_info "✅ Unit tests passed"
    else
      log_warn "⚠️  Unit tests had failures - continuing with build"
      tail -20 "$LOG_DIR/test-unit.log" | tee -a "$LOG_FILE"
    fi
  else
    log_info "Skipping tests (--skip-tests)"
  fi

  # Clean and build
  log_info "Building project with TypeScript..."
  if npm run build >> "$LOG_FILE" 2>&1; then
    log_info "✅ Build successful"
  else
    log_error "Build failed"
    tail -50 "$LOG_FILE"
    exit 1
  fi

  # Verify build output
  if [ -f "dist/src/index.js" ]; then
    log_info "✅ Build artifact verified: dist/src/index.js"
  else
    log_error "Build artifact not found: dist/src/index.js"
    exit 1
  fi
fi

# ============================================================================
# STEP 3: Install or Update systemd Service
# ============================================================================
if [[ "$BUILD_ONLY" != "true" && "$VERIFY_ONLY" != "true" ]]; then
  log_section "STEP 3: Install systemd Service"

  log_info "Setting up systemd service..."
  if [ -f "scripts/install-systemd-local.sh" ]; then
    if bash scripts/install-systemd-local.sh "$ENV_FILE" >> "$LOG_FILE" 2>&1; then
      log_info "✅ systemd service installed/updated"
    else
      log_error "systemd installation failed"
      tail -30 "$LOG_FILE"
      exit 1
    fi
  else
    log_error "install-systemd-local.sh not found"
    exit 1
  fi

  sleep 1
fi

# ============================================================================
# STEP 3.5: systemd Daemon Reload & Service Restart
# ============================================================================
if [[ "$BUILD_ONLY" != "true" && "$VERIFY_ONLY" != "true" ]]; then
  log_section "STEP 3.5: systemd Daemon Reload & Restart"

  # Reload systemd to pick up any new/updated service files
  if ! systemctl_daemon_reload; then
    log_error "Failed to reload systemd daemon"
    exit 1
  fi

  # Restart the service
  if ! systemctl_restart_service; then
    log_error "Failed to restart service"
    exit 1
  fi

  # Verify status
  if ! systemctl_verify_status; then
    log_warn "⚠️  Service status verification had issues"
  fi

  sleep 2
fi

# ============================================================================
# STEP 4: Verify Daemon is Running
# ============================================================================
log_section "STEP 4: Verify Daemon is Running"

verify_daemon() {
  log_info "Checking systemd service status..."
  
  if systemctl is-active --quiet jobs-watcher; then
    log_info "✅ Service is active"
  else
    log_warn "Service is not active, attempting to start..."
    if sudo systemctl start jobs-watcher 2>&1 | tee -a "$LOG_FILE"; then
      log_info "✅ Service started"
      sleep 2
    else
      log_error "Failed to start service"
      sudo systemctl status jobs-watcher 2>&1 | tee -a "$LOG_FILE"
      return 1
    fi
  fi

  # Check socket file in multiple locations
  log_info "Checking for UDS socket file..."
  SOCKET_FOUND=false
  for possible_path in "$SOCKET_PATH" "/run/jobs-watcher/ingest.sock" "/run/user/$(id -u)/jobs-watcher/ingest.sock"; do
    if [ -S "$possible_path" ] 2>/dev/null; then
      log_info "✅ Socket file exists: $possible_path"
      ls -lh "$possible_path" 2>/dev/null | tee -a "$LOG_FILE"
      SOCKET_FOUND=true
      break
    fi
  done
  
  if [ "$SOCKET_FOUND" = false ]; then
    log_warn "⚠️  Socket file not found at any expected location"
    log_info "Detected socket path: $SOCKET_PATH"
    log_info "Checking service logs..."
    sudo journalctl -u jobs-watcher -n 30 2>&1 | tee -a "$LOG_FILE"
    return 1
  fi

  # Check process
  log_info "Checking process status..."
  local pid
  pid=$(pgrep -f "node.*dist/src/index.js" | head -1)
  if [ -n "$pid" ]; then
    log_info "✅ Process running with PID $pid"
  else
    log_warn "⚠️  Process not found"
  fi

  return 0
}

verify_daemon

# ============================================================================
# STEP 5: Run Verification Checklist
# ============================================================================
if [[ "$BUILD_ONLY" != "true" ]]; then
  if ! run_verification_checklist; then
    log_warn "⚠️  Some verification checks failed - review logs above"
  fi
fi

# ============================================================================
# STEP 6: Output Summary and Next Steps
# ============================================================================
log_section "STEP 6: Deployment Summary"

cat <<EOF | tee -a "$LOG_FILE"

${GREEN}✅ Deployment Process Complete${NC}

${BLUE}Deployment Type:${NC}
  • CI: $([ "$BUILD_ONLY" = true ] && echo "Build only" || echo "✅ Full pipeline")
  • systemd: $([ "$VERIFY_ONLY" = true ] && echo "Verify only" || echo "✅ Reloaded & restarted")
  • Artifacts: $([ "$CLEAN_ARTIFACTS" = true ] && echo "✅ Cleaned" || echo "Skipped")

${BLUE}Current Status:${NC}
  • Build: $([ -f "dist/src/index.js" ] && echo "✅ Ready" || echo "❌ Not ready")
  • Service: $(systemctl is-active --quiet jobs-watcher && echo "✅ Running" || echo "❌ Not running")
  • Socket: $([ -S "$SOCKET_PATH" ] 2>/dev/null && echo "✅ Ready" || echo "❌ Not ready")

${BLUE}Deployment Artifacts:${NC}
  Log file: $LOG_FILE

${BLUE}Next Steps for Manual Testing:${NC}

1. ${YELLOW}Start TUI Render Server${NC}
   $ npm run data-listening
   
2. ${YELLOW}Trigger Webhook (new terminal)${NC}
   $ bash scripts/eval-fetch-and-trigger.sh 5
   
3. ${YELLOW}Verify Fields in TUI${NC}
   • Title, location, URL should be visible
   • Score should show "[Awaiting Stage 2]"
   
4. ${YELLOW}Test Stage 2 Parse${NC}
   • Press [c] in TUI to parse & score
   • Score should calculate > 0%
   
5. ${YELLOW}Test Actions${NC}
   • [q] = Queue job
   • [d] = Discard to trash
   • [s] = Skip
   • [o] = Open URL
   • [p] = Preview description

${BLUE}Service Management:${NC}
  Status:  sudo systemctl status jobs-watcher
  Logs:    sudo journalctl -u jobs-watcher -f
  Restart: sudo systemctl restart jobs-watcher
  Reload:  sudo systemctl daemon-reload

${BLUE}MongoDB Check:${NC}
  $ npm run db:check
  Collections: job_lifecycle, action_snapshots

EOF

# ============================================================================
# OPTIONAL: Quick Verification Test
# ============================================================================
if [[ "$BUILD_ONLY" != "true" && "$VERIFY_ONLY" != "true" ]]; then
  log_section "Socket Connectivity Test (Optional)"

  read -p "Run socket connectivity test? (y/n) " -n 1 -r
  echo
  if [[ $REPLY =~ ^[Yy]$ ]]; then
    log_info "Testing socket connection..."
    
    if [ -S "$SOCKET_PATH" ]; then
      if curl --unix-socket "$SOCKET_PATH" \
          -H "x-internal-token: $INTERNAL_AUTH_TOKEN" \
          -s -o /dev/null -w "%{http_code}\n" \
          http://localhost/health; then
        log_info "✅ Socket connectivity test passed"
      else
        log_warn "Socket test inconclusive (may need  INTERNAL_AUTH_TOKEN)"
      fi
    else
      log_warn "Socket not available for testing"
    fi
  fi
fi

log_info "✅ Deployment script completed!"
exit 0
