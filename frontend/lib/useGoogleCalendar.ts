"use client";

import { useCallback, useEffect, useState } from "react";
import {
  googleStatus, listCalendars, importBusy, CalendarInfo,
} from "@/lib/api";
import { TimeBlock } from "@/lib/types";

export interface UseGoogleCalendar {
  connected: boolean;
  calendars: CalendarInfo[];
  selectedIds: string[];
  loadCalendars: () => Promise<void>;
  toggleCalendar: (id: string) => void;
  importWeek: (weekStart: string) => Promise<TimeBlock[]>;
}

export function useGoogleCalendar(base?: string): UseGoogleCalendar {
  const [connected, setConnected] = useState(false);
  const [calendars, setCalendars] = useState<CalendarInfo[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  useEffect(() => {
    googleStatus(base).then(setConnected).catch(() => setConnected(false));
  }, [base]);

  const loadCalendars = useCallback(async () => {
    const cals = await listCalendars(base);
    setCalendars(cals);
    setSelectedIds(cals.filter((c) => c.selected_by_default).map((c) => c.id));
  }, [base]);

  const toggleCalendar = useCallback((id: string) => {
    setSelectedIds((prev) =>
      prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id],
    );
  }, []);

  const importWeek = useCallback(
    (weekStart: string) => importBusy(weekStart, selectedIds, base),
    [selectedIds, base],
  );

  return { connected, calendars, selectedIds, loadCalendars, toggleCalendar, importWeek };
}
