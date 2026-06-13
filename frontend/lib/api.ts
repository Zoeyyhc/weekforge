import { StartDebateRequest } from "@/lib/types";

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
