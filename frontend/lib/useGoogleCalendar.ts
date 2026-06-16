"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import {
  googleStatus, googleDisconnect, listCalendars, importBusy, CalendarInfo,
} from "@/lib/api";
import { TimeBlock } from "@/lib/types";

export interface UseGoogleCalendar {
  connected: boolean;
  statusKnown: boolean;
  calendars: CalendarInfo[];
  selectedIds: string[];
  loadCalendars: () => Promise<void>;
  toggleCalendar: (id: string) => void;
  importWeek: (weekStart: string) => Promise<TimeBlock[]>;
  disconnect: () => Promise<void>;
}

export function useGoogleCalendar(base?: string): UseGoogleCalendar {
  const [connected, setConnected] = useState(false);
  const [statusKnown, setStatusKnown] = useState(false);
  const [calendars, setCalendars] = useState<CalendarInfo[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  // Ref mirrors selectedIds so importWeek always reads the latest value even
  // when called immediately after loadCalendars (before the next render).
  const selectedIdsRef = useRef<string[]>([]);

  useEffect(() => {
    googleStatus(base)
      .then((c) => { setConnected(c); setStatusKnown(true); })
      .catch(() => { setConnected(false); setStatusKnown(true); });
  }, [base]);

  const loadCalendars = useCallback(async () => {
    const cals = await listCalendars(base);
    const ids = cals.filter((c) => c.selected_by_default).map((c) => c.id);
    selectedIdsRef.current = ids;
    setCalendars(cals);
    setSelectedIds(ids);
  }, [base]);

  const toggleCalendar = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
      selectedIdsRef.current = next;
      return next;
    });
  }, []);

  const importWeek = useCallback(
    (weekStart: string) => importBusy(weekStart, selectedIdsRef.current, base),
    [base],
  );

  const disconnect = useCallback(async () => {
    await googleDisconnect(base);
    setConnected(false);
  }, [base]);

  return { connected, statusKnown, calendars, selectedIds, loadCalendars, toggleCalendar, importWeek, disconnect };
}
