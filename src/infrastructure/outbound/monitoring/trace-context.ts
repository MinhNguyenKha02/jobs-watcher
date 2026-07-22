import { randomUUID } from 'crypto';

export interface TraceContext {
  traceId: string;
  parentSpanId?: string;
}

export interface TraceHeaders {
  'x-trace-id': string;
  'x-parent-span-id'?: string;
}

export function createTraceContext(parent?: TraceContext): TraceContext {
  return {
    traceId: parent?.traceId ?? randomUUID(),
    parentSpanId: parent?.parentSpanId,
  };
}

export function traceContextToHeaders(ctx: TraceContext): TraceHeaders {
  const headers: TraceHeaders = { 'x-trace-id': ctx.traceId };
  if (ctx.parentSpanId) {
    headers['x-parent-span-id'] = ctx.parentSpanId;
  }
  return headers;
}

export function headersToTraceContext(headers: Record<string, unknown>): TraceContext | null {
  const traceId = headers['x-trace-id'];
  if (typeof traceId !== 'string' || !traceId) return null;
  const ctx: TraceContext = { traceId };
  const parentSpanId = headers['x-parent-span-id'];
  if (typeof parentSpanId === 'string' && parentSpanId) {
    ctx.parentSpanId = parentSpanId;
  }
  return ctx;
}
