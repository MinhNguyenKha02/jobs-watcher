
# Jobs Watcher

A self-hosted TypeScript/Node.js daemon for automating job intake,
job-description extraction, and profile-driven resume generation.

Jobs Watcher processes job-related Gmail messages into structured job
records. It uses a bounded Playwright worker pool to extract job-page
HTML, supports manual recovery through a terminal UI (TUI), and routes
selected records into a profile-driven retrieval pipeline for tailored
resume PDF generation.

## What it does

- **Ingests:** accepts Gmail-triggered inputs through the application's
  ingestion interface.
- **Extracts:** uses three Playwright workers to retrieve job-page HTML.
- **Recovers:** supports operator-assisted browsing and manual HTML
  ingestion when automatic extraction cannot complete.
- **Tracks:** persists job lifecycle data and extraction scheduling state
  in MongoDB.
- **Resolves:** uses profile information retrieval and evidence scoring
  to identify job-relevant capabilities.
- **Generates:** renders tailored resume PDFs from Handlebars templates.

## Architecture

The system runs as a single-host Linux daemon.

- **Application orchestration:** TypeScript application layer with
  dependency-injected ports and adapters.
- **Persistence:** MongoDB for job lifecycle records and the extraction queue.
- **Queued processing:** RabbitMQ for distributing lifecycle events.
- **Browser automation:** Playwright workers managed by an extraction
  scheduler.
- **Operator interface:** TUI processes communicating with the daemon
  through Unix Domain Sockets and RabbitMQ.
- **Operations:** systemd-managed execution, logging, and Prometheus
  instrumentation.

## Processing workflow

1. Ingest job metadata from Gmail-related inputs.
2. Persist the partial job record and schedule eligible URLs for extraction.
3. Extract job-page HTML automatically or use the manual recovery path.
4. Parse the HTML and merge it with the existing job metadata, or accept
   a standalone manual HTML input.
5. Let the operator route the resulting record for downstream processing
   or discard it.
6. For accepted records, retrieve profile evidence and generate a
   tailored resume PDF.

## Design

The application layer coordinates the workflow through ports and
replaceable infrastructure adapters. The extraction scheduler manages
the browser worker pool independently of the main ingestion flow.
MongoDB stores lifecycle state; RabbitMQ distributes checkpoint events;
Unix Domain Sockets carry local operator commands.

The manual path is part of the workflow design, not a separate
application: it allows an operator to recover from extraction failures
and provide HTML directly.

## Processing boundaries

The extraction queue is used during ingestion to schedule browser-based
job-page extraction. It is not a downstream queue for profile information
retrieval.

After the operator routes a full job record for processing at S3, the
profile information retrieval and asset-generation path runs synchronously.
Resolved profile data is passed to the Handlebars template and rendered to
PDF using Playwright.

S3 marks completion of the ingestion workflow. End-to-end processing is
complete only after downstream information retrieval and document
generation finish.

## Verification

## Limitations
