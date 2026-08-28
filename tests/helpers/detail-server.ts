import http from 'node:http';

import { indeedDetailHtml } from './html-fixtures.js';

export const CASES_C2 = {
  c2Auto: { role: 'Backend Developer', company: 'C2AutoCo' },
  c2Data: { role: 'Data Engineer', company: 'C2DataCo' },
  c2Trash: { role: 'Full Stack Developer', company: 'C2TrashCo' },
  c2Qa: { role: 'Full-stack Developer', company: 'C2QaCo' },
  c2Ring: { role: 'Software Engineer', company: 'C2RingCo' },
  c2RingNext: { role: 'Automation Engineer', company: 'C2RingNextCo' },
} as const;

const KEY_BY_JOB_C2: Record<string, string> = Object.fromEntries(
  Object.entries(CASES_C2).map(([key, job]) => [`${job.role}|${job.company}`, key])
);

/**
 * URL must satisfy the ingestor's S1 enqueue heuristic (`indeed.com/viewjob?`)
 * while pointing at a local server the Scheduler/Playwright can actually fetch.
 * The query carries a single `src` token (no `&`, so cheerio keeps the href
 * intact) which the server maps back to role/company.
 */
export function startDetailServer(
  cases: Record<string, { role: string; company: string }> = CASES_C2 as unknown as Record<
    string,
    { role: string; company: string }
  >,
  keyByJob: Record<string, string> = KEY_BY_JOB_C2
): Promise<{
  srcUrl: (role: string, company: string) => string;
  close: () => Promise<void>;
}> {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const parsed = new URL(req.url || '/', 'http://127.0.0.1');
      const src = parsed.searchParams.get('src') || '';
      const decodedSrc = (() => {
        try {
          return decodeURIComponent(src);
        } catch {
          return src;
        }
      })();
      const job =
        (cases as Record<string, { role: string; company: string }>)[src] ??
        (cases as Record<string, { role: string; company: string }>)[decodedSrc] ??
        (CASES_C2 as Record<string, { role: string; company: string }>)[src] ??
        (CASES_C2 as Record<string, { role: string; company: string }>)[decodedSrc] ??
        (CASES_C2 as Record<string, { role: string; company: string }>).c2Auto;
      res.writeHead(200, { 'Content-Type': 'text/html' });
      res.end(
        indeedDetailHtml(
          job.role,
          job.company,
          `http://127.0.0.1:${(server.address() as unknown as { port: number }).port}/indeed.com/viewjob?src=${src}`
        )
      );
    });
    server.listen(0, '127.0.0.1', () => {
      const addr = server.address() as unknown as { port: number };
      resolve({
        srcUrl: (role, company) => {
          const key = keyByJob[`${role}|${company}`];
          const src = key ?? encodeURIComponent(`${role}|${company}`);
          return `http://127.0.0.1:${addr.port}/indeed.com/viewjob?src=${src}`;
        },
        close: () => new Promise<void>((r) => server.close(() => r())),
      });
    });
  });
}
