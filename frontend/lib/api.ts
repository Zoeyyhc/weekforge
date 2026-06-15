import { StartDebateRequest, TimeBlock } from "@/lib/types";

export const API_BASE =
  process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000";

export async function startDebate(
  request: StartDebateRequest,
  base: string = API_BASE,
): Promise<string> {
  const res = await fetch(`${base}/debate`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(request),
  });
  if (!res.ok) {
    throw new Error(`Failed to start debate: ${res.status}`);
  }
  const data = await res.json();
  return data.thread_id as string;
}

export async function sendIntervention(
  threadId: string,
  input: string,
  base: string = API_BASE,
): Promise<void> {
  const res = await fetch(`${base}/debate/${threadId}/intervene`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ input }),
  });
  if (!res.ok) {
    throw new Error(`Failed to send intervention: ${res.status}`);
  }
}

export function streamUrl(threadId: string, base: string = API_BASE): string {
  return `${base}/debate/${threadId}/stream`;
}

export interface CalendarInfo {
  id: string;
  summary: string | null;
  primary: boolean;
  selected_by_default: boolean;
}

export interface ExportResult {
  written: number;
  calendar_url: string;
}

export async function googleStatus(base: string = API_BASE): Promise<boolean> {
  const res = await fetch(`${base}/auth/google/status`);
  if (!res.ok) throw new Error(`Failed to read Google status: ${res.status}`);
  const data = await res.json();
  return Boolean(data.connected);
}

export function googleLoginUrl(base: string = API_BASE): string {
  return `${base}/auth/google/login`;
}

export function googleDisconnectUrl(base: string = API_BASE): string {
  return `${base}/auth/google/disconnect`;
}

export async function googleDisconnect(base: string = API_BASE): Promise<void> {
  const res = await fetch(`${base}/auth/google/disconnect`, { method: "POST" });
  if (!res.ok) throw new Error(`Failed to disconnect: ${res.status}`);
}

export async function listCalendars(base: string = API_BASE): Promise<CalendarInfo[]> {
  const res = await fetch(`${base}/calendar/google/calendars`);
  if (!res.ok) throw new Error(`Failed to list calendars: ${res.status}`);
  const data = await res.json();
  return data.calendars as CalendarInfo[];
}

export async function importBusy(
  weekStart: string,
  calendarIds: string[],
  base: string = API_BASE,
): Promise<TimeBlock[]> {
  const params = new URLSearchParams();
  params.set("week_start", weekStart);
  for (const id of calendarIds) params.append("calendar_ids", id);
  const res = await fetch(`${base}/calendar/google/busy?${params.toString()}`);
  if (!res.ok) throw new Error(`Failed to import busy blocks: ${res.status}`);
  const data = await res.json();
  return data.busy_blocks as TimeBlock[];
}

export async function exportSchedule(
  weekStart: string,
  blocks: TimeBlock[],
  timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
  base: string = API_BASE,
): Promise<ExportResult> {
  const res = await fetch(`${base}/calendar/google/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ week_start: weekStart, blocks, time_zone: timeZone }),
  });
  if (!res.ok) throw new Error(`Failed to export schedule: ${res.status}`);
  return (await res.json()) as ExportResult;
}
