#!/usr/bin/env bash
# log-format.sh
# Usage: log <level> <origin> <message>
# Example: log info myscript "Hello world"

log() {
  local level="$1"; shift
  local origin="$1"; shift
  local msg="$*"
  local ts
  ts="$(date -Iseconds)"
  local symbol
  case "$level" in
    info) symbol="[*]";;
    warn) symbol="[!]";;
    error) symbol="[!]";;
    debug) symbol="[*]";;
    success) symbol="[✓]";;
    *) symbol="[*]";;
  esac
  echo "$ts $symbol [$origin] $msg"
}

export -f log
