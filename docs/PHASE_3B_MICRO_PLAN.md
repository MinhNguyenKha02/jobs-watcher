# Phase 3B Micro Plan (Automation & Analytics)

**Window**: 1 week
**Goal**: Automate application sending and collect actionable metrics
**Phases**:
- Sprint 4: Application Sender ✉️ (Automation)
- Sprint 5: Metrics & Analytics 📊

---

## Sprint 4 (3B.1): Application Sender ✉️
**Outcome**: Automatically send generated applications (PDF/DOCX) to job contacts or portals.

### Deliverables
1) **Sender Service**
- Service to send emails with PDF/DOCX attachments
- Support for SMTP and/or job portal APIs
- Configurable sender identity and templates

2) **Delivery Status Tracking**
- Track sent status, delivery errors, and retries
- Store logs in action_log or similar collection

3) **Tests**
- Unit tests for sender logic and error handling
- Integration tests for email/portal delivery

### Acceptance Criteria
- Applications are sent automatically for eligible jobs
- Delivery status and errors are logged
- No duplicate sends for same job/profile
- All tests pass

---

## Sprint 5 (3B.2): Metrics & Analytics 📊

**Outcome**: Collect, analyze, and visualize application and system metrics, with a focus on profile-driven, job-fit-driven, and gaps-driven insights. Enable continuous improvement and versioned releases.

### Tech Choices & Data Design
* **NoSQL vs SQL**: 
  - NoSQL (e.g., MongoDB) for flexible, evolving analytics and event logs (action_log, analytics collections).
  - SQL (e.g., Postgres) for structured, relational metrics and historical versioning if strong consistency or complex joins are needed.
  - Consider hybrid approach: NoSQL for event streams, SQL for aggregates and reporting.
* **Profile/Job-Fit/Gaps Analytics**:
  - Store profile/job-fit/gap scores per application event.
  - Enable queries for gaps (skills, experience) and fit (matching criteria).
* **Versioning & Release**:
  - Tag analytics schema and dashboard releases (v1, v2, ...).
  - Document improvements/enhancements per version.

### Deliverables
1) **Metrics Recorder**
	- Record actions: sent, opened, replied, failed, job-fit score, profile gaps, etc.
	- Store in analytics/event collections (NoSQL) or metrics tables (SQL).

2) **Analytics & Aggregates**
	- Queries for: success rate, response time, job-fit, gaps, profile trends, etc.
	- Aggregates for dashboard: totals, averages, time-series, thin pyramid (funnel) metrics.
	- Exportable reports (CSV/JSON).

3) **Dashboard (Optimal/Optional)**
	- Visualize key metrics and aggregates (web or CLI dashboard).
	- Thin pyramid/funnel analytics: visualize drop-offs and conversion at each stage.
	- Profile-driven and job-fit-driven views.

4) **Tests**
	- Unit tests for metrics recording, queries, and aggregates.
	- Integration tests for analytics pipeline and dashboard.

### Criteria & Enhancement Targets
- All key actions and analytics are logged with timestamps and version tags.
- Metrics and aggregates are queryable, exportable, and visualizable.
- Analytics support profile-driven, job-fit-driven, and gaps-driven insights.
- Dashboard provides thin pyramid/funnel analytics.
- Versioning and release notes for analytics/dashboard improvements.
- All tests pass.

---

## Gate (Phase 3B)
**User can automate sending and analyze application outcomes.**
