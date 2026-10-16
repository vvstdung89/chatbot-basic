/** Diagnostic events are separate from the browser's ChatEvent stream. */
export interface TraceEvent {
  type: string;
  /** Prompts, queries and tool payloads; omitted by the default logger. */
  content?: unknown;
  [key: string]: unknown;
}

export type TraceCallback = (event: TraceEvent) => void;

/** Observing a chat must never change its outcome. Callbacks are synchronous. */
export function emitTrace(onTrace: TraceCallback | undefined, event: TraceEvent): void {
  try {
    onTrace?.(event);
  } catch {
    // A broken log sink must not interrupt a reply or tool call.
  }
}

/** One JSON record per event, correlated and timed from request creation. */
export function createTrace({
  requestId,
  captureContent = false,
  write,
}: {
  requestId: string;
  captureContent?: boolean;
  write: (line: string) => void;
}): TraceCallback {
  const start = performance.now();
  return (event) => {
    const { content, ...metadata } = event;
    const record = {
      ...metadata,
      requestId,
      elapsedMs: Math.round(performance.now() - start),
      ...(captureContent &&
        content !== undefined && {
          content: JSON.parse(
            JSON.stringify(content, (_key, value: unknown) =>
              typeof value === 'string' ? value.replace(/\d{6,}/g, '[redacted]') : value,
            ),
          ),
        }),
    };
    write(JSON.stringify(record));
  };
}
