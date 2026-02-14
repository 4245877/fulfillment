import { useEffect, useRef, useState } from "react";

export function useSSE(url, { onEvent } = {}) {
  const onEventRef = useRef(onEvent);
  const [status, setStatus] = useState("idle"); // idle | connecting | open | error | closed

  // чтобы не пересоздавать EventSource при каждом ререндере
  useEffect(() => {
    onEventRef.current = onEvent;
  }, [onEvent]);

  useEffect(() => {
    if (!url) return;

    let es = null;
    let stopped = false;
    let retry = 0;
    let timer = null;

    const cleanup = () => {
      if (timer) {
        clearTimeout(timer);
        timer = null;
      }
      if (es) {
        try { es.close(); } catch {}
        es = null;
      }
    };

    const connect = () => {
      if (stopped) return;

      setStatus("connecting");

      cleanup();
      try {
        // withCredentials тут не нужен при same-origin через proxy/nginx
        es = new EventSource(url);

        es.onopen = () => {
          retry = 0;
          setStatus("open");
        };

        es.onmessage = (e) => {
          try {
            const data = JSON.parse(e.data);
            onEventRef.current && onEventRef.current(data);
          } catch {
            // игнорируем мусор/комментарии
          }
        };

        es.onerror = () => {
          if (stopped) return;
          setStatus("error");

          // мягкий реконнект с backoff
          cleanup();
          const n = Math.min(6, retry++);
          const delay = Math.min(15000, 500 * 2 ** n);

          timer = setTimeout(() => {
            if (!stopped) connect();
          }, delay);
        };
      } catch {
        setStatus("error");
      }
    };

    connect();

    return () => {
      stopped = true;
      setStatus("closed");
      cleanup();
    };
  }, [url]);

  return { status };
}
