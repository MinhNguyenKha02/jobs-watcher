# Socket Permissions - Security Hardening Guide

## 📊 Permission Levels Explained

| Permissions | Symbolic | Readable By | Writable By | Security | Use Case |
|-------------|----------|------------|-----------|----------|----------|
| **600** | rw------- | Owner only | Owner only | 🟢 Strict | Not suitable (TUI user can't access) |
| **660** | rw-rw---- | Owner + Group | Owner + Group | 🟡 Good | **Recommended for jobs-watcher** |
| **666** | rw-rw-rw- | Everyone | Everyone | 🔴 Weak | Current (temporary fix, security risk) |
| **770** | rwxrwx--- | Owner + Group | Owner + Group | 🟡 Good | For directories (/run/jobs-watcher) |

---

## 🎯 Current Issue

**Current State**: Socket is `srw-rw-rw-` (666)
- ❌ Everyone on the system can access the socket
- ❌ Security risk (any process can read/write)
- ✅ Functional (TUI can connect)

**Desired State**: Socket is `srw-rw----` (660) with `jobs-watcher:jobs-watcher` group
- ✅ Only authorized users in group can access
- ✅ Better security model
- ✅ Still allows TUI user to connect via group membership

---

## 🔧 Implementation Strategy

### Step 1: Create Access Control Group

```bash
sudo groupadd -f jobs-watcher
```

Creates a system group called `jobs-watcher` for access control.

### Step 2: Add TUI User to Group

```bash
sudo usermod -a -G jobs-watcher $(whoami)
```

Adds current user to `jobs-watcher` group so they can access the socket.

### Step 3: Set Socket Ownership and Permissions

```bash
sudo chown root:jobs-watcher /run/jobs-watcher/ingest.sock
sudo chmod 660 /run/jobs-watcher/ingest.sock
```

Sets socket to:
- **Owner**: root (daemon process)
- **Group**: jobs-watcher (access control)
- **Permissions**: 660 (owner + group can read/write)

### Step 4: Set Directory Permissions

```bash
sudo chown root:jobs-watcher /run/jobs-watcher
sudo chmod 770 /run/jobs-watcher
```

Ensures directory permissions allow group members to access socket file.

### Step 5: Automate with Systemd

Update `/etc/systemd/system/jobs-watcher.service`:

```ini
[Service]
# Socket runtime management
RuntimeDirectory=jobs-watcher
RuntimeDirectoryMode=0770
RuntimeDirectoryPreserve=restart

# User and group
User=root
Group=jobs-watcher

# Security
ProtectSystem=strict
ProtectHome=yes
NoNewPrivileges=yes
RestrictNamespaces=yes
```

This ensures:
- Systemd creates `/run/jobs-watcher` with proper permissions
- Permissions survive systemd restarts
- Socket inherits group ownership

---

## 🚀 Automation Script

Run the setup script to apply all changes:

```bash
bash scripts/setup-socket-permissions.sh
```

This script:
1. Creates `jobs-watcher` group
2. Adds current user to group
3. Sets socket permissions to 660
4. Sets directory permissions to 770
5. Verifies the setup
6. Shows next steps

---

## 🔍 Verification

### Check Current Permissions

```bash
ls -la /run/jobs-watcher/ingest.sock
# Should show: srw-rw---- root jobs-watcher

ls -la /run/jobs-watcher/
# Should show: drwxrwx--- root jobs-watcher
```

### Check User Group Membership

```bash
groups $(whoami)
# Should include: jobs-watcher
```

### Verify Socket Access

```bash
# Try connecting to socket
curl --unix-socket /run/jobs-watcher/ingest.sock \
  -X POST \
  -H "Content-Type: application/json" \
  -d '{"test":"ok"}' \
  http://daemon/internal/ingest

# Should get: 202 Accepted or valid error response
# NOT: "Permission denied"
```

### Run Diagnostic

```bash
bash scripts/diagnose-clipboard-parse.sh
# Should show: ✅ All checks passed!
```

---

## ⚠️ Important Notes

### Group Membership Activation

After running the setup script, **log out and log back in** for group changes to take effect:

```bash
# Option 1: Log out and back in (full shell restart)
exit
# Then log back in

# Option 2: Start a new shell with group
newgrp jobs-watcher

# Option 3: Check without relogin
exec su - $(whoami)
```

### Socket Recreation on Daemon Restart

When the daemon restarts, the socket is recreated. Systemd will apply the `RuntimeDirectory` settings automatically.

### Current Workaround (666 Permissions)

If you can't run the setup script immediately:
- Current `666` permissions allow TUI to work
- They are **temporary** and should be replaced with `660`
- Document as technical debt to fix in next deployment

---

## 🔐 Security Comparison

### Before (666 - Overly Permissive)
```
-rw-rw-rw- owner group
  ↓   ↓   ↓
  ↓   ↓   └─ Others: read/write ← 🔴 SECURITY RISK
  ↓   └───── Group: read/write
  └───────── Owner: read/write
```

**Risk**: Any user on the system can connect to daemon socket and:
- Read job data
- Modify job data
- Inject malicious jobs
- Disrupt operations

---

### After (660 - Group-Based)
```
-rw-rw---- owner group
  ↓   ↓   ↓
  ↓   ↓   └─ Others: (no access) ← ✅ SECURE
  ↓   └───── Group: read/write
  └───────── Owner: read/write
```

**Benefits**:
- Only `root` and members of `jobs-watcher` group can access
- Can revoke access by removing user from group
- Scalable (add more users to group as needed)
- Clear audit trail (group membership)

---

## 📋 Deployment Checklist

- [ ] Run setup script: `bash scripts/setup-socket-permissions.sh`
- [ ] Log out and back in to activate group membership
- [ ] Restart daemon: `sudo systemctl restart jobs-watcher`
- [ ] Verify socket permissions: `ls -la /run/jobs-watcher/ingest.sock`
- [ ] Run diagnostic: `bash scripts/diagnose-clipboard-parse.sh`
- [ ] Test [c] action in TUI
- [ ] Update systemd service file with security settings
- [ ] Document in RELEASE_NOTES.md

---

## 📝 Future Improvements

### Use Unix Socket Access Control

More advanced systems might use:
- **SELinux** labels on socket
- **AppArmor** profiles for daemon
- **Capabilities** instead of root user
- **Namespaces** for isolation

For now, group-based 660 is the practical choice.

### Multi-Service Architecture

If TUI runs as different user:
- Create separate TUI user: `jobs-watcher-tui`
- Add both to `jobs-watcher` group
- Runs fine with 660 permissions

### Container Deployment

In Docker/Kubernetes:
- Mount `/run/jobs-watcher` from host
- Set permissions at build time
- Use volume mount options to enforce permissions

---

## 🆘 Troubleshooting

### "Permission denied" on socket access

```bash
# Check permissions
ls -la /run/jobs-watcher/ingest.sock

# Check user is in group
groups $(whoami)

# Fix: Run setup script and log out/in
bash scripts/setup-socket-permissions.sh
exit  # log out
# log back in
```

### Socket doesn't exist

```bash
# Check daemon is running
systemctl status jobs-watcher

# Check daemon logs
journalctl -u jobs-watcher -n 20

# Socket created on first job (webhook trigger)
bash scripts/eval-fetch-and-trigger.sh 1
sleep 2
ls -la /run/jobs-watcher/ingest.sock
```

### Group not taking effect

```bash
# Option 1: Log out completely
exit
# log back in

# Option 2: Start new shell with group
newgrp jobs-watcher

# Option 3: Check group is applied
groups $(whoami)
```

### Diagnostic still fails

```bash
# Collect debug info
ls -la /run/jobs-watcher/ingest.sock
groups $(whoami)
id $(whoami)
stat /run/jobs-watcher/ingest.sock

# Run diagnostic with verbose output
bash -x scripts/diagnose-clipboard-parse.sh
```

---

## Summary

**Current**: 666 (world-readable) - Works but insecure  
**Recommended**: 660 with `jobs-watcher` group - Better security  
**Setup Time**: ~2 minutes + log out/in  
**Risk**: Low (just file permissions)  
**Benefit**: Improved security posture  

Run `bash scripts/setup-socket-permissions.sh` to apply the hardened configuration.
