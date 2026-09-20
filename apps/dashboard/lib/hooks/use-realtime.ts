"use client";

import { useEffect, useRef, useState } from "react";

export type RealtimeEvent =
  | {
      type: "request";
      id: number;
      ts: string;
      model: string;
      agent: string;
      team: string;
      costUsd: number;
      status: number;
      chainId: string;
    }
  | { type: "alert"; seq: number; ts: string; action: string; budgetId: string; detail: string };

export type RealtimeStatus = "connecting" | "open" | "closed" | "error";

const MAX_EVENTS = 100;

/**
 * Live feed from /api/events (SSE, 60s server bound). Reconnects with
 * backoff using high-water marks; caps the buffer at 100 events.
 */
export function useRealtime(enabled = true) {
  const [events, setEvents] = useState<RealtimeEvent[]>([]);
  const [status, setStatus] = useState<RealtimeStatus>("connecting");
  const marks = useRef({ sinceId: 0, sinceSeq: 0 });
  const retries = useRef(0);

  useEffect(() => {
    if (!enabled || typeof window === "undefined" || typeof EventSource === "undefined") {
      setStatus("closed");
      return;
    }
    let es: EventSource | null = null;
    let reconnect: ReturnType<typeof setTimeout> | null = null;
    let disposed = false;

    const push = (e: RealtimeEvent) =>
      setEvents((prev) => [e, ...prev].slice(0, MAX_EVENTS));

    const connect = () => {
      if (disposed) return;
      setStatus("connecting");
      const qs = new URLSearchParams({
        sinceId: String(marks.current.sinceId),
        sinceSeq: String(marks.current.sinceSeq),
      });
      es = new EventSource(`/api/events?${qs.toString()}`);

      es.addEventListener("open", (ev) => {
        try {
          const hello = JSON.parse((ev as MessageEvent).data ?? "{}") as {
            sinceId?: number;
            sinceSeq?: number;
          };
          if (hello.sinceId) marks.current.sinceId = hello.sinceId;
          if (hello.sinceSeq) marks.current.sinceSeq = hello.sinceSeq;
        } catch {
          /* keep existing marks */
        }
        retries.current = 0;
        setStatus("open");
      });

      es.addEventListener("request", (ev) => {
        try {
          const d = JSON.parse((ev as MessageEvent).data) as Omit<RealtimeEvent & { type: "request" }, "type"> & {
            id: number;
          };
          if (d.id > marks.current.sinceId) marks.current.sinceId = d.id;
          push({ ...d, type: "request" });
        } catch {
          /* malformed frame: skip */
        }
      });

      es.addEventListener("alert", (ev) => {
        try {
          const d = JSON.parse((ev as MessageEvent).data) as Omit<RealtimeEvent & { type: "alert" }, "type"> & {
            seq: number;
          };
          if (d.seq > marks.current.sinceSeq) marks.current.sinceSeq = d.seq;
          push({ ...d, type: "alert" });
        } catch {
          /* malformed frame: skip */
        }
      });

      es.addEventListener("close", () => {
        // Server-side 60s bound: reconnect immediately with fresh marks.
        es?.close();
        if (!disposed) connect();
      });

      es.onerror = () => {
        es?.close();
        setStatus("error");
        if (disposed) return;
        const backoff = Math.min(1000 * 2 ** retries.current, 15000);
        retries.current += 1;
        reconnect = setTimeout(connect, backoff);
      };
    };

    connect();
    return () => {
      disposed = true;
      if (reconnect) clearTimeout(reconnect);
      es?.close();
      setStatus("closed");
    };
  }, [enabled]);

  const clear = () => setEvents([]);

  return { events, status, clear };
}
