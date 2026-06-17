import { StartDebateRequest, TimeBlock } from "@/lib/types";
import { API_BASE } from "@/lib/apiBase";
import { getToken } from "@/lib/auth";

export { API_BASE };

function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function startDebate(
  request: StartDebateRequest,
  base: string = API_BASE,
): Promise<string> {
  const res = await fetch(`${base}/debate`, {
    method: "POST",
    headers: { "Content-Type": "application/json", ...authHeaders() },
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
    headers: { "Content-Type": "application/json", ...authHeaders() },
    body: JSON.stringify({ input }),
  });
  if (!res.ok) {
    throw new Error(`Failed to send intervention: ${res.status}`);
  }
}

export function streamUrl(threadId: string, base: string = API_BASE): string {
  const token = getToken();
  const q = token ? `?token=${encodeURIComponent(token)}` : "";
  return `${base}/debate/${threadId}/stream${q}`;
}

export async function exportIcs(
  weekStart: string,
  blocks: TimeBlock[],
  timeZone: string = Intl.DateTimeFormat().resolvedOptions().timeZone,
  base: string = API_BASE,
): Promise<Blob> {
  const res = await fetch(`${base}/calendar/ics/export`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ week_start: weekStart, blocks, time_zone: timeZone }),
  });
  if (!res.ok) throw new Error(`Failed to build calendar file: ${res.status}`);
  return res.blob();
}
