# Beta Staging Plan

## 1. Core Workflow & Monitoring
- **Stable flow:** Input job → parse → score → customize → generate → export.
- **Monitor each stage:** Log success/failure, errors, and timing for every step.
- **Self-feedback:** Use logs and error counts for your own review.
- **Beta user feedback (optional):** Google Form or email for user-reported issues.

## 2. Versioning & Tagging
- **Semantic versioning:** Tag every beta cycle (e.g., v1.0.0-beta.1).
- **Release notes:** Document changes and metrics for each tag.
- **Non-negotiable:** No untagged releases; rollback always possible.

## 3. Metrics & Evaluation
- **Hypothesis:** “Users will use automated application packaging >3 times per week.”
- **Metrics:**
  - Weekly active usage per user
  - Job processing success rate
  - Error frequency (by severity)
  - Uptime
  - Feedback count (self + users)
- **Thresholds:**
  - ≥2 sessions/user/week
  - ≥95% job success rate
  - <2% critical error rate
  - ≥99% uptime
  - ≥80% positive feedback
- **Exit criteria:** All thresholds met for 2 consecutive weeks, no critical bugs, positive feedback, backup/rollback tested.

## 4. Backup & Rollback
- **Backup:** Schedule regular DB/config backups before each beta tag.
- **Test restore:** Periodically restore from backup to verify.
- **Rollback:** Use git tags and backup to revert on failure.

## 5. Minimal Overhead & Tooling
- **Pre-commit:** Only lint, type-check, and unit tests (see .husky/pre-commit).
- **CI/CD:** Only essential checks (see .github/workflows/beta.yml).
- **Monitoring:** Lightweight logs, error counts, and one feedback channel.
- **No extra dashboards or heavy infra.**

## 6. Feedback Loop
- **Self:** Review logs and error counts daily.
- **Users (optional):** Collect feedback via email or form.
- **Weekly review:** Aggregate feedback and metrics, decide on next steps.

## 7. Optional Enhancements
- UI/UX tweaks, performance, reporting, or integrations—only after core flow is stable.
