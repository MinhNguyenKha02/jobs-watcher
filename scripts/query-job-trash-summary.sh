#!/usr/bin/env bash
# Query job_trash collection for reason counts and print summary
# Usage: ./query-job-trash-summary.sh [mongo-uri] [db-name]

MONGO_URI=${1:-"mongodb://127.0.0.1:27017"}
DB_NAME=${2:-"jobs_watcher"}

mongosh "$MONGO_URI/$DB_NAME" --quiet --eval '
db.job_trash.aggregate([
  { $group: { _id: "$reason", count: { $sum: 1 } } },
  { $sort: { count: -1 } }
]).forEach(function(doc) {
  print(doc._id + "\t" + doc.count);
})
'
