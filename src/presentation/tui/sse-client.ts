/**
 * SSE Client - Minimal SSE EventSource wrapper
 * Used by SseJobReader and TuiJobPresenter for SSE connections
 */

import EventSource from 'eventsource';

type SseCallbacks = {
  onOpen?: () => void;
  onMessage?: (event: any) => void;
  onError?: (error: any) => void;
  onClose?: () => void;
};

const SSE_EVENT_TYPES = [
  'job.generated',
  'job.parse.completed',
  'job.parse.failed',
  'job.route.queued',
  'job.route.trashed',
  'job.route.failed',
];

type SseHandle = {
  close: () => void;
};

export default function startSseClient(
  baseUrl: string,
  token: string | undefined,
  callbacks: SseCallbacks
): SseHandle {
  const url = token ? `${baseUrl}?token=${encodeURIComponent(token)}` : baseUrl;
  
  const eventSource = new EventSource(url);
  
  let connectionTimeout: ReturnType<typeof setTimeout> | null = null;
  let rejected = false;
  
  eventSource.onopen = () => {
    if (connectionTimeout) clearTimeout(connectionTimeout);
    if (!rejected) {
      callbacks.onOpen?.();
    }
  };
  
  SSE_EVENT_TYPES.forEach((eventType) => {
    eventSource.addEventListener(eventType, (event: any) => {
      try {
        const data = JSON.parse(event.data);
        callbacks.onMessage?.({
          type: eventType,
          payload: data,
        });
      } catch (e) {
        console.error('[sse-client] Failed to parse event data', { eventType, error: String(e), data: event.data?.substring?.(0, 100) });
        callbacks.onMessage?.({
          type: eventType,
          payload: event.data,
        });
      }
    });
  });

  eventSource.onmessage = (event: any) => {
    try {
      const data = JSON.parse(event.data);
      const eventType = event.type || data.type || 'message';
      callbacks.onMessage?.({
        type: eventType,
        payload: data,
      });
    } catch (e) {
      callbacks.onMessage?.({
        type: event.type || 'message',
        payload: event.data,
      });
    }
  };
  
  eventSource.onerror = (error: any) => {
    if (!rejected && eventSource.readyState === EventSource.CONNECTING) {
      if (!connectionTimeout) {
        connectionTimeout = setTimeout(() => {
          rejected = true;
          callbacks.onError?.(error);
        }, 3000);
      }
      return;
    }
    if (!rejected) {
      rejected = true;
      callbacks.onError?.(error);
    }
  };
  
  return {
    close: () => {
      if (connectionTimeout) clearTimeout(connectionTimeout);
      eventSource.close();
    },
  };
}