/**
 * Saga entry helpers — `whenS1Many` is the only `S1` entry (`s1Count=4`), `whenS2b` is the single `clip-*` direct entry.
 * Reused by `unit(app)` (mock) and `integ` (real) — caller passes the 2-IoC `daemon`/`tui`.
 */
import { JobStage, JobSource } from '../../src/domain/types/job-lifecycle.js';
import type { TestDaemonContainer, MockTestDaemonContainer, TuiTestContainer } from './test-container.js';

type AnyDaemon = TestDaemonContainer | MockTestDaemonContainer;

export async function whenS1Many(daemon: AnyDaemon, htmlMany: string, messageId: string): Promise<void> {
  await daemon.apps.ingest.processIngest(
    JobSource.BROWSER_AUTO,
    JobStage.PARTIAL_PARSED,
    htmlMany,
    undefined,
    { messageId }
  );
}

export async function whenS2a(daemon: AnyDaemon, html: string, pickId: string): Promise<void> {
  await daemon.apps.ingest.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, html, pickId);
}

export async function whenS2b(daemon: AnyDaemon, clipHtml: string): Promise<void> {
  await daemon.apps.ingest.processIngest(JobSource.MANUAL, JobStage.FULL_PARSED, clipHtml);
}

export async function whenQueue(tui: TuiTestContainer, id: string): Promise<void> {
  await tui.writer.queue(id);
}

export async function whenTrash(tui: TuiTestContainer, id: string): Promise<void> {
  await tui.writer.trash(id);
}
