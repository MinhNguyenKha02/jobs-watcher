# Job Processing, Queueing, and Deduplication

## Supported Input Contexts

Jobs Watcher supports three input adapters for job ingestion:
- **Gmail Watcher (Pub/Sub Webhook):** Real-time, event-driven ingestion from Gmail. Listens on loopback for security. ACKs fast, processes in background.
- **Pub/Sub Fallback:** If Gmail webhook fails, retries via Pub/Sub. All failures are logged and retried deterministically. No silent drops.
- **Manual Clipboard Importer:** Manual job entry or clipboard paste for jobs from external platforms. Used for platforms not directly integrated or for fallback/manual validation.

All input contexts are funneled into the same job queue, ensuring consistent deduplication, idempotency, and processing logic regardless of source. Deterministic engineering rules ensure:
- No silent failures: All errors are logged and traceable.
- Fallbacks are explicit, non-negotiable, and self-assigned.
- Schedule configuration and constraints are enforced (see below).

See [ARCHITECTURE.md](ARCHITECTURE.md#supported-input-contexts) and [DECISIONS.md](DECISIONS.md#input-contexts--platform-support) for architectural details.

---

## Schedule Configuration & Constraints

- **Semantic Versioning:** Every release is tagged (vX.Y.Z). No untagged deployments.
- **Backup & Rollback:** DB/config backups before each tag. Rollback is O(1) via tag reference.
- **Time Reduction:** Queue-based concurrency, early termination for filtered jobs, memory/cpu constraints enforced.
- **Deterministic Rules:** Atomic commits, conventional commit messages, strict boundaries (UI → Application → Domain → Infrastructure).
- **Fallback Logic:** Pub/Sub retry, manual import, explicit error handling. No silent fallback or skip.

All constraints and fallback logic are non-negotiable and self-assigned. See [.agent-custome-rules.instructions.md](../.github/.agent-custome-rules.instructions.md) for engineering rules.

This document details the strategy for job processing, queue management, and deduplication in the Jobs Watcher system.

---

## Overview

Jobs Watcher processes incoming jobs (e.g., emails, webhook events) using a queue-based architecture. This ensures reliable, scalable, and deduplicated handling of jobs, even under bursty or concurrent loads.

---

## Key Concepts

- **Job Queue:** All incoming jobs are enqueued for processing. This decouples event ingestion from processing, allowing for retries and backpressure.
- **Deduplication:** Each job is assigned a unique identifier (e.g., messageId, hash). The system checks for duplicates before processing.
- **Idempotency:** Job handlers are designed to be idempotent, so re-processing a job (due to retries or duplicates) does not cause side effects.
- **Concurrency:** Workers can process jobs in parallel, but deduplication ensures each unique job is handled only once.

---

## Flow Diagram

```mermaid
graph TD
    A[Receive Event (Webhook, Poll, CLI)] --> B[Enqueue Job]
    B --> C{Is Duplicate?}
    C -- Yes --> D[Drop/Log Duplicate]
    C -- No --> E[Process Job]
    E --> F[Persist Result]
    F --> G[Mark as Processed]
```

---


## Implementation Example

```typescript
// Pseudocode for queue-based job processing with deduplication
async function handleIncomingJob(job) {
  if (await isDuplicate(job.id)) {
    log('Duplicate job, skipping:', job.id);
    return;
  }
  await markInProgress(job.id);
  try {
    await processJob(job);
    await markProcessed(job.id);
  } catch (err) {
    await markFailed(job.id, err);
    throw err;
  }
}
```

- **Queue:** Can be in-memory for development, or use Redis/BullMQ/RabbitMQ for production/distributed deployments.
- **Deduplication Store:** In-memory Set is fast for single-instance; use Redis or MongoDB for cross-session or multi-instance deduplication.
- **Retries:** Failed jobs can be retried with exponential backoff.
- **Idempotency:** All job handlers must be idempotent to ensure safe retries and duplicate suppression.

## Recent Queue Reliability Improvements

- Integrated CI job for daily metrics aggregation and log review
- Automated alerting for stuck/failed jobs via CI pipeline
- CI updates documentation and exit criteria status after each cycle
- Metrics recorder and analytics queries now part of job processing flow
- Improved deduplication and idempotency checks for long-living reliability
- Dead-letter queue implementation for repeated failures
- Enhanced monitoring: success/error rates, job counts, deduplication stats

- **CI Automation:**
  - CI jobs run metrics aggregation, log review, and documentation update steps as described in [MICRO_PLAN.md](../MICRO_PLAN.md).
  - Feedback and exit criteria are checked and updated automatically after each cycle.
  - Manual and clipboard input jobs are included in metrics and deduplication statistics.



- **Queue Backend:** Start with in-memory for development; migrate to Redis, BullMQ, or RabbitMQ for production or distributed deployments.
- **Deduplication:** In-memory Set is fast for single-instance; use Redis or MongoDB for cross-session or multi-instance deduplication.
- **Idempotency:** All job handlers must be idempotent to ensure safe retries and duplicate suppression.
- **Monitoring:** Add metrics and alerting for stuck or failed jobs as the system scales.
- **Dead-letter Queue:** For jobs that fail repeatedly, implement a dead-letter queue for manual review.

---

## References

- See `docs/ARCHITECTURE.md` (Application Layer, Services Layer)
- See `docs/DECISIONS.md` (Decision: Queue-based job processing)
- Example code: `src/services/job-queue.ts`, `src/application/job-processor.ts`

---

## Benefits

- Handles bursty loads gracefully
- Prevents duplicate processing
- Enables horizontal scaling
- Improves reliability and observability

---

## Trade-offs

- Slightly increased complexity (queue management, deduplication store)
- Requires monitoring for stuck or failed jobs

---

## Future Improvements

- Distributed queue (e.g., BullMQ, RabbitMQ) for large-scale deployments
- Dead-letter queue for failed jobs
- Metrics and alerting for job processing health
