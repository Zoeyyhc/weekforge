"use client";

import { useCallback, useReducer, useRef } from "react";
import {
  debateReducer,
  initialDebateState,
  DebateState,
} from "@/lib/debateReducer";
import { sendIntervention, startDebate, streamUrl } from "@/lib/api";
import { DebateMessage, StartDebateRequest } from "@/lib/types";

const EVENT_TYPES = ["debate_event", "interrupt", "done", "error"] as const;

export interface UseDebateStream {
  state: DebateState;
  start: (request: StartDebateRequest) => Promise<void>;
  intervene: (input: string) => Promise<void>;
  reset: () => void;
}

export function useDebateStream(base?: string): UseDebateStream {
  const [state, dispatch] = useReducer(debateReducer, initialDebateState);
  const sourceRef = useRef<EventSource | null>(null);
  const threadRef = useRef<string | null>(null);

  const closeStream = useCallback(() => {
    sourceRef.current?.close();
    sourceRef.current = null;
  }, []);

  const openStream = useCallback(
    (threadId: string) => {
      closeStream();
      dispatch({ kind: "streaming" });
      const es = new EventSource(streamUrl(threadId, base));
      sourceRef.current = es;
      for (const t of EVENT_TYPES) {
        es.addEventListener(t, (ev) => {
          const message = JSON.parse((ev as MessageEvent).data) as DebateMessage;
          dispatch({ kind: "message", message });
          // The stream ends after any non-debate_event frame; stop listening so
          // the browser does not auto-reconnect and re-run the graph.
          if (message.type !== "debate_event") {
            closeStream();
          }
        });
      }
      es.onerror = () => {
        closeStream();
      };
    },
    [base, closeStream],
  );

  const start = useCallback(
    async (request: StartDebateRequest) => {
      dispatch({ kind: "reset" });
      const threadId = await startDebate(request, base);
      threadRef.current = threadId;
      openStream(threadId);
    },
    [base, openStream],
  );

  const intervene = useCallback(
    async (input: string) => {
      const threadId = threadRef.current;
      if (!threadId) return;
      await sendIntervention(threadId, input, base);
      openStream(threadId);
    },
    [base, openStream],
  );

  const reset = useCallback(() => {
    closeStream();
    threadRef.current = null;
    dispatch({ kind: "reset" });
  }, [closeStream]);

  return { state, start, intervene, reset };
}
