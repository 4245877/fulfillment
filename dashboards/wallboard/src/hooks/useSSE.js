import { useEffect } from "react";
export function useSSE(url, { onEvent }) {
  useEffect(() => {
    if (!url) return;
    const off = (function() {
      let closed = false;
      const close = () => { if (!closed){ es && es.close(); closed = true; } };
      const es = new EventSource(url, { withCredentials: true });
      es.onmessage = (e)=> { try{ onEvent && onEvent(JSON.parse(e.data)); } catch {} };
      es.onerror   = close;
      return close;
    })();
    return off;
  }, [url, onEvent]);
}
