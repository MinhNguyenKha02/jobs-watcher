import http from 'node:http';

export interface UdsRequestOptions {
  socketPath: string;
  path: string;
  method?: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
}

// UDS POSTs are low-frequency operator actions: use a fresh unix connection
// per call (no keep-alive reuse). The shared globalAgent reuses idle sockets
// past the server's 5s keepAliveTimeout (uds-adapter.ts), which surfaces as a
// rare `read ECONNRESET` on the response read. Fresh connections remove the class.
const noKeepAliveAgent = new http.Agent({ keepAlive: false });

export function postJsonOverUds(
  opts: UdsRequestOptions,
  body: unknown
): Promise<{ statusCode: number; body: string }> {
  const payload = typeof body === 'string' ? body : JSON.stringify(body || {});
  const options: http.RequestOptions = {
    method: opts.method || 'POST',
    path: opts.path,
    socketPath: opts.socketPath,
    agent: noKeepAliveAgent,
    headers: Object.assign(
      { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      opts.headers || {}
    ),
  };

  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      const bufs: Buffer[] = [];
      res.on('data', (c: Buffer | string) => bufs.push(typeof c === 'string' ? Buffer.from(c) : c));
      res.on('end', () => {
        const text = Buffer.concat(bufs).toString();
        resolve({ statusCode: res.statusCode || 0, body: text });
      });
    });
    req.on('error', (err) => reject(err));
    if (opts.timeoutMs)
      req.setTimeout(opts.timeoutMs, () => {
        req.destroy(new Error('timeout'));
      });
    req.write(payload);
    req.end();
  });
}
