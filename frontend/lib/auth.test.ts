import { afterEach, describe, expect, it, vi } from "vitest";
import {
  clearToken,
  fetchMe,
  getToken,
  login,
  savePreferences,
  setToken,
  signup,
} from "@/lib/auth";

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

describe("token storage", () => {
  it("round-trips and clears", () => {
    expect(getToken()).toBeNull();
    setToken("abc");
    expect(getToken()).toBe("abc");
    clearToken();
    expect(getToken()).toBeNull();
  });
});

describe("signup/login", () => {
  it("signup posts credentials and returns token + user", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        token: "t1",
        user: { id: "u1", email: "a@b.com", display_name: "Ada" },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const res = await signup("a@b.com", "pw", "Ada");
    expect(res.token).toBe("t1");
    expect(res.user.display_name).toBe("Ada");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(/\/auth\/signup$/);
    expect(JSON.parse(init.body)).toEqual({
      email: "a@b.com",
      password: "pw",
      display_name: "Ada",
    });
  });

  it("login throws on non-ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    await expect(login("a@b.com", "bad")).rejects.toThrow();
  });
});

describe("fetchMe", () => {
  it("returns the user and preferences on success", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        user: { id: "u1", email: "a@b.com", display_name: "Ada" },
        preferences: {
          workday_start_hour: 9,
          workday_end_hour: 17,
          max_focus_minutes_per_day: 300,
          timezone: "Australia/Melbourne",
        },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const result = await fetchMe("tok-123");

    expect(result.user.email).toBe("a@b.com");
    expect(result.preferences?.timezone).toBe("Australia/Melbourne");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8001/auth/me",
      expect.objectContaining({
        headers: { Authorization: "Bearer tok-123" },
      }),
    );
  });

  it("throws on non-ok", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false, status: 401 }));
    await expect(fetchMe("bad-token")).rejects.toThrow(/fetchMe failed: 401/);
  });
});

describe("savePreferences", () => {
  it("sends the preferences payload with bearer auth", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        workday_start_hour: 8,
        workday_end_hour: 16,
        max_focus_minutes_per_day: 240,
        timezone: null,
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const prefs = {
      workday_start_hour: 8,
      workday_end_hour: 16,
      max_focus_minutes_per_day: 240,
      timezone: null,
    };
    const result = await savePreferences("tok-456", prefs);

    expect(result).toEqual(prefs);
    expect(fetchMock).toHaveBeenCalledWith(
      "http://127.0.0.1:8001/auth/me/preferences",
      expect.objectContaining({
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: "Bearer tok-456",
        },
        body: JSON.stringify(prefs),
      }),
    );
  });
});
