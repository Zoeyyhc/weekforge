import { describe, it, expect, vi, afterEach } from "vitest";
import { startDebate, sendIntervention, streamUrl } from "@/lib/api";
import {
  googleStatus, googleLoginUrl, listCalendars, importBusy,
  exportSchedule, googleDisconnectUrl,
} from "@/lib/api";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("startDebate", () => {
  it("POSTs the request and returns the thread_id", async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ thread_id: "abc123" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const tid = await startDebate({ tasks: [{ id: "t1", title: "X", estimated_minutes: 30 }] }, "http://api");

    expect(tid).toBe("abc123");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api/debate");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body).tasks[0].id).toBe("t1");
  });

  it("throws when the response is not ok", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: false, status: 500 })));
    await expect(
      startDebate({ tasks: [{ id: "t1", title: "X", estimated_minutes: 30 }] }, "http://api"),
    ).rejects.toThrow(/500/);
  });
});

describe("sendIntervention", () => {
  it("POSTs the input to the intervene endpoint", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ status: "accepted" }) }));
    vi.stubGlobal("fetch", fetchMock);

    await sendIntervention("tid-1", "Prioritise the report", "http://api");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api/debate/tid-1/intervene");
    expect(JSON.parse(init.body)).toEqual({ input: "Prioritise the report" });
  });
});

describe("streamUrl", () => {
  it("builds the SSE URL for a thread", () => {
    expect(streamUrl("tid-1", "http://api")).toBe("http://api/debate/tid-1/stream");
  });
});

describe("google calendar helpers", () => {
  it("googleStatus returns connected flag", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ connected: true }) })));
    expect(await googleStatus("http://api")).toBe(true);
  });

  it("googleLoginUrl builds the login endpoint", () => {
    expect(googleLoginUrl("http://api")).toBe("http://api/auth/google/login");
  });

  it("listCalendars returns the calendars array", async () => {
    const cals = [{ id: "p", summary: "me", primary: true, selected_by_default: true }];
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true, json: async () => ({ calendars: cals }) })));
    expect(await listCalendars("http://api")).toEqual(cals);
  });

  it("importBusy passes week_start and repeated calendar_ids", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ busy_blocks: [] }) }));
    vi.stubGlobal("fetch", fetchMock);
    await importBusy("2026-06-15", ["a@x", "b@x"], "http://api");
    const url = fetchMock.mock.calls[0][0] as string;
    expect(url).toContain("/calendar/google/busy?");
    expect(url).toContain("week_start=2026-06-15");
    expect(url).toContain("calendar_ids=a%40x");
    expect(url).toContain("calendar_ids=b%40x");
  });

  it("exportSchedule posts week_start and blocks, returns the result", async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, json: async () => ({ written: 2, calendar_url: "u" }) }));
    vi.stubGlobal("fetch", fetchMock);
    const res = await exportSchedule(
      "2026-06-15T00:00:00+00:00",
      [{ start: "s", end: "e", label: "L", task_id: "t1" }],
      "http://api",
    );
    expect(res).toEqual({ written: 2, calendar_url: "u" });
    const [, init] = fetchMock.mock.calls[0];
    expect(JSON.parse((init as RequestInit).body as string).blocks).toHaveLength(1);
  });

  it("googleDisconnectUrl builds the disconnect endpoint", () => {
    expect(googleDisconnectUrl("http://api")).toBe("http://api/auth/google/disconnect");
  });
});
