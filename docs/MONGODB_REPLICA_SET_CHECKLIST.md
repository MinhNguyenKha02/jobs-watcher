# MongoDB Replica Set Validation Checklist

## Pre-Production: Ensure Replica Set is Configured

The jobs-watcher system uses MongoDB change-streams for SSE event broadcasting. Change-streams require a replica set. This checklist ensures your MongoDB deployment is properly configured before deploying jobs-watcher to production.

### 1. Verify Replica Set Status

```bash
# Connect to your MongoDB instance and check replica set status
mongosh --host localhost:27017

# Inside mongosh:
rs.status()
```

**Expected output:** You should see 0-3 nodes in the replica set with status like:
```json
{
  "set": "rs0",
  "date": "...",
  "myState": 1,
  "members": [
    {
      "_id": 0,
      "name": "localhost:27017",
      "health": 1,
      "state": 1,
      "stateStr": "PRIMARY",
      ...
    }
  ]
}
```

**If you get an error:** Replica set is not initialized. Follow "Initializing a Replica Set" below.

### 2. Initializing a Replica Set (Single Node)

For local development or single-node replicas, initialize a replica set:

```bash
# Connect to MongoDB
mongosh --host localhost:27017

# Inside mongosh:
rs.initiate({
  _id: "rs0",
  members: [
    { _id: 0, host: "localhost:27017" }
  ]
})

# Verify it worked
rs.status()
```

After initialization, the node should transition to `stateStr: "PRIMARY"` within a few seconds.

### 3. Configure MONGODB_URI with Replica Set

Before deploying jobs-watcher, ensure your `MONGODB_URI` environment variable includes the replica set name:

```bash
# Good: includes replica set
export MONGODB_URI="mongodb://localhost:27017/?replicaSet=rs0"

# Bad: missing replica set
export MONGODB_URI="mongodb://localhost:27017/"
```

Set this in your systemd env file or `.env`:

```bash
# /etc/jobs-watcher.env
MONGODB_URI=mongodb://localhost:27017/?replicaSet=rs0
```

### 4. Test Startup with Production Environment

Once your MongoDB is configured, test the jobs-watcher startup with replica set validation:

```bash
# Set production environment and start jobs-watcher
NODE_ENV=production \
MONGODB_URI="mongodb://localhost:27017/?replicaSet=rs0" \
npm run start
```

**Expected output:** You should see logs indicating successful connection:
```
[index.ts] validateMongoTopology: ✅ MongoDB replica set detected
[index.ts] ✅ MongoDB storage connected (index startup)
```

**If you see errors:**
- "replicaSet=rs0 does not match the replica set name" → Your actual replica set name differs; check `rs.status()` and update the URI.
- "setName is undefined" → Replica set not initialized; follow step 2.

### 5. Verify Change-Stream Support

Jobs Watcher uses MongoDB change-streams. Verify they work:

```bash
# Inside mongosh, connected to your replica set:

# 1. Create a test collection
db.createCollection("test_change_stream")

# 2. Watch for changes
const stream = db.test_change_stream.watch()

# In another mongosh terminal:
db.test_change_stream.insertOne({ test: true })

# First terminal should show the change event printed
```

If change-streams don't work, your replica set is misconfigured.

### 6. Systemd Service Verification

Once everything is ready, deploy via systemd:

```bash
# Install systemd units
sudo bash scripts/install-systemd-local.sh /etc/jobs-watcher.env

# Start the service
sudo systemctl start jobs-watcher-webhook.service

# Check logs
sudo journalctl -u jobs-watcher-webhook.service -f
```

**Expected logs:**
```
jobs-watcher-webhook[PID]: ✅ MongoDB storage connected (index startup)
jobs-watcher-webhook[PID]: 🔒 Local ingest socket listening at /run/jobs-watcher/ingest.sock
jobs-watcher-webhook[PID]: 📧 Watching Gmail label: "...label..."
```

### 7. Production Deployment Checklist

Before moving to production:

- [ ] MongoDB replica set initialized (`rs.status()` returns valid config)
- [ ] `MONGODB_URI` includes `?replicaSet=<name>` in `/etc/jobs-watcher.env`
- [ ] Test startup passes with `NODE_ENV=production`
- [ ] Change-streams work (manual test completed)
- [ ] Systemd units deployed (`systemd-analyze verify` passes)
- [ ] Socket directory exists with correct permissions: `ls -la /run/jobs-watcher/ingest.sock`
- [ ] TUI can connect: `npm run tui` shows "SSE connected ✓"

### Troubleshooting

| Issue | Cause | Fix |
|-------|-------|-----|
| "setName" error | Replica set not initialized | Run `rs.initiate({...})` in mongosh |
| "replicaSet mismatch" | URI replica set name doesn't match | Check `rs.status()`, update `MONGODB_URI` |
| Change-stream hangs | Replica set down or misconfigured | Verify `rs.status()` shows PRIMARY |
| "Socket exists" error | Old socket file not cleaned | Delete `/run/jobs-watcher/ingest.sock` and restart |
| SSE not receiving events | Change-stream not enabled | Verify replica set is initialized and health is 1 |

### References

- [MongoDB Replica Set Docs](https://docs.mongodb.com/manual/replication/)
- [Change Streams Guide](https://docs.mongodb.com/manual/changeStreams/)
- jobs-watcher validation code: `src/services/mongodb-validator.ts`
