import { API_BASE } from "@/lib/apiBase";

export interface User {
  id: string;
  email: string;
  display_name: string;
}

export interface SavedPreferences {
  workday_start_hour: number;
  workday_end_hour: number;
  max_focus_minutes_per_day: number;
  timezone: string | null;
}

const TOKEN_KEY = "weekforge.token";

export function getToken(): string | null {
  if (typeof window === "undefined") return null;
  return window.localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function clearToken(): void {
  if (typeof window === "undefined") return;
  window.localStorage.removeItem(TOKEN_KEY);
}

async function postJson<T>(path: string, body: unknown): Promise<T> {
  const res = await fetch(`${API_BASE}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${path} failed: ${res.status}`);
  return res.json() as Promise<T>;
}

export function signup(email: string, password: string, displayName: string) {
  return postJson<{ token: string; user: User }>("/auth/signup", {
    email,
    password,
    display_name: displayName,
  });
}

export function login(email: string, password: string) {
  return postJson<{ token: string; user: User }>("/auth/login", { email, password });
}

export async function fetchMe(
  token: string,
): Promise<{ user: User; preferences: SavedPreferences | null }> {
  const res = await fetch(`${API_BASE}/auth/me`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(`fetchMe failed: ${res.status}`);
  return res.json();
}

export async function savePreferences(
  token: string,
  prefs: SavedPreferences,
): Promise<SavedPreferences> {
  const res = await fetch(`${API_BASE}/auth/me/preferences`, {
    method: "PUT",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
    body: JSON.stringify(prefs),
  });
  if (!res.ok) throw new Error(`savePreferences failed: ${res.status}`);
  return res.json();
}
