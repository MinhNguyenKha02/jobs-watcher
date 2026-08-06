import http from 'node:http';

export interface UdsRequestOptions {
  socketPath: string;
  path: string;
  method?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

export function postJsonOverUds(opts: UdsRequestOptions, body: unknown): Promise<{ statusCode: number; body: string }> {
  const payload = typeof body === 'string' ? body : JSON.stringify(body || {});
  const options: any = {
    method: opts.method || 'POST',
    path: opts.path,
    socketPath: opts.socketPath,
    headers: Object.assign({ 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) }, opts.headers || {}),
  };

  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const bufs: Buffer[] = [];
      res.on('data', (c) => bufs.push(Buffer.from(c)));
      res.on('end', () => {
        const text = Buffer.concat(bufs).toString();
        resolve({ statusCode: res.statusCode || 0, body: text });
      });
    });
    req.on('error', (err) => reject(err));
    if (opts.timeoutMs) req.setTimeout(opts.timeoutMs, () => { req.destroy(new Error('timeout')); });
    req.write(payload);
    req.end();
  });
}
