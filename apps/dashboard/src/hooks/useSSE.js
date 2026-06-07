import { useEffect, useRef, useState } from "react";

const MAX_RETRY_POWER = 6;
const MAX_RETRY_DELAY_MS = 15000;
const BASE_RETRY_DELAY_MS = 500;

export function useSSE(url, { onEvent } = {}) {
  const onEventRef = useRef(onEvent);
  const [status, setStatus] = useState("idle"); // idle | connecting | open | error

  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!url) {
      setStatus("idle");
      return undefined;
    }

    let es = null;
    let stopped = false;
    let retry = 0;
    let timer = null;

    const closeEventSource = () => {
      if (!es) return;

      try {
        es.close();
      } catch {
        // ignore close errors
      }

      es = null;
    };

    const clearRetryTimer = () => {
      if (!timer) return;

      clearTimeout(timer);
      timer = null;
    };

    const cleanup = () => {
      clearRetryTimer();
      closeEventSource();
    };

    const scheduleReconnect = () => {
      if (stopped) return;

      setStatus("error");
      cleanup();

      const n = Math.min(MAX_RETRY_POWER, retry);
      retry += 1;

      const delay = Math.min(MAX_RETRY_DELAY_MS, BASE_RETRY_DELAY_MS * 2 ** n);

      timer = setTimeout(() => {
        if (!stopped) {
          connect();
        }
      }, delay);
    };

    const connect = () => {
      if (stopped) return;

      setStatus("connecting");
      cleanup();

      try {
        es = new EventSource(url);

        es.onopen = () => {
          retry = 0;
          setStatus("open");
        };

        es.onmessage = (event) => {
          try {
            const data = JSON.parse(event.data);
            onEventRef.current?.(data);
          } catch {
            // ignore invalid SSE payloads
          }
        };

        es.onerror = () => {
          scheduleReconnect();
        };
      } catch {
        scheduleReconnect();
      }
    };

    connect();

    return () => {
      stopped = true;
      cleanup();
    };
  }, [url]);

  return { status };
}