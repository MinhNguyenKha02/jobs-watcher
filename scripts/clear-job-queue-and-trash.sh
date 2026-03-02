#!/usr/bin/env bash
# Clear job_queue and job_trash collections in jobs_watcher DB
# Usage: ./clear-job-queue-and-trash.sh [mongo-uri] [db-name]

MONGO_URI=${1:-"mongodb://127.0.0.1:27017"}
DB_NAME=${2:-"jobs_watcher"}

mongosh "$MONGO_URI/$DB_NAME" --quiet --eval '
db.job_queue.deleteMany({});
db.job_trash.deleteMany({});
print("Cleared job_queue and job_trash collections.");
'
