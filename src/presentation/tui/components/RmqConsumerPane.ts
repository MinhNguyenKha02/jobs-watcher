/**
 * RmqConsumerPane — 4-line compact local-only RMQ consumer strip for PC pane (60% w).
 * Full labels, mid-truncate _id `19ee…job-1` (head4…job-N), 5× prefetch no overflow.
 */

import type { PendingSnapshot } from '../ports/job-event-reader.port.js';

export function midTruncateId(id: string, maxLen = 11): string {
  if (id.length <= maxLen) return id;
  const dashIdx = id.lastIndexOf('-');
  const suffix = dashIdx !== -1 ? id.slice(dashIdx) : id.slice(-6);
  const head = id.slice(0, 4);
  const candidate = `${head}…${suffix.replace(/^-/, 'job-')}`;
  // ensure `19ee…job-1` style: suffix already `job-1` if original `-job-1`
  if (candidate.length <= maxLen) return candidate;
  // fallback: head…tail6
  return `${head}…${id.slice(-6)}`;
}

export function renderRmqConsumerPane(snapshot: PendingSnapshot, width = 96): string {
  const inner = Math.max(10, width - 2);
  const lines: string[] = [];
  const border = '─'.repeat(inner);

  lines.push(`┌${border}┐`);

  // Line1 full labels
  const line1 = ` Q:${snapshot.depth} P:${snapshot.partial} F:${snapshot.full} D:${snapshot.deferred} · tui.jobs.s1/s2/s2d/s3s4 · ${snapshot.connected ? '🟢' : '🔴'} pref 5/5/1/5 queue:${snapshot.queueMode ? 'ON' : 'OFF'}`;
  lines.push(`│${truncateMid(line1, inner).padEnd(inner)}│`);

  // Line2 cur (first pending if any)
  const curId = snapshot.peekIds[0];
  const curStage = snapshot.peekStages[0];
  const curLine = curId
    ? ` cur: ${midTruncateId(curId)} ${curStage === 'partial' ? 'PARTIAL' : 'FULL'}`
    : ' cur: —';
  lines.push(`│${truncateMid(curLine, inner).padEnd(inner)}│`);

  // Line3 pend: up to 5 ids, each mid-truncated + (P/F), overflow +N
  const pendCap = 5;
  const pendIds = snapshot.peekIds.slice(0, pendCap);
  const pendStages = snapshot.peekStages.slice(0, pendCap);
  let pendLine = ' pend: ';
  if (pendIds.length === 0) pendLine += '—';
  else {
    const parts = pendIds.map(
      (id, i) => `${midTruncateId(id)}(${pendStages[i] === 'partial' ? 'P' : 'F'})`
    );
    let joined = parts.join(' ');
    if (snapshot.depth > pendCap) joined += ` +${snapshot.depth - pendCap} more`;
    pendLine += joined;
  }
  lines.push(`│${truncateMid(pendLine, inner).padEnd(inner)}│`);

  // Line4 def
  let defLine = ' def: ';
  if (snapshot.deferred === 0) defLine += '—';
  else {
    const dIds = snapshot.deferredIds.slice(0, 5).map(midTruncateId);
    defLine += dIds.join(' ') + ` TTL 30s`;
  }
  lines.push(`│${truncateMid(defLine, inner).padEnd(inner)}│`);

  lines.push(`└${border}┘`);
  return lines.join('\n');
}

function truncateMid(text: string, max: number): string {
  if (text.length <= max) return text;
  return text.slice(0, max - 3) + '...';
}
