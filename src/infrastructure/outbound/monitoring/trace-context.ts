import { randomUUID } from 'crypto';

export interface TraceContext {
  traceId: string;
  parentSpanId?: string;
}

export interface TraceHeaders {
  xTraceId: string;
  xParentSpanId?: string;
}

export function createTraceContext(parent?: TraceContext): TraceContext {
  return {
    traceId: parent?.traceId ?? randomUUID(),
    parentSpanId: parent?.parentSpanId,
  };
}

export function traceContextToHeaders(ctx: TraceContext): TraceHeaders {
  const headers: TraceHeaders = { xTraceId: ctx.traceId };
  if (ctx.parentSpanId) {
    headers.xParentSpanId = ctx.parentSpanId;
  }
  return headers;
}

export function headersToTraceContext(headers: TraceHeaders): TraceContext | null {
  const traceId = headers.xTraceId;
  if (typeof traceId !== 'string' || !traceId) return null;
  const ctx: TraceContext = { traceId };
  const parentSpanId = headers.xParentSpanId;
  if (typeof parentSpanId === 'string' && parentSpanId) {
    ctx.parentSpanId = parentSpanId;
  }
  return ctx;
}
