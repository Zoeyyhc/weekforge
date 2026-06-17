import { describe, it, expect, vi, afterEach } from "vitest";
import { startDebate, sendIntervention, streamUrl } from "@/lib/api";
import { exportIcs } from "@/lib/api";

afterEach(() => vi.restoreAllMocks());

describe("startDebate", () => {
  it("POSTs the request and returns the thread_id", async () => {
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({
      ok: true,
      json: async () => ({ thread_id: "abc123" }),
    }));
    vi.stubGlobal("fetch", fetchMock);

    const tid = await startDebate({ tasks: [{ id: "t1", title: "X", estimated_minutes: 30 }] }, "http://api");

    expect(tid).toBe("abc123");
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api/debate");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body as string).tasks[0].id).toBe("t1");
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
    const fetchMock = vi.fn(async (_url: string, _init: RequestInit) => ({ ok: true, json: async () => ({ status: "accepted" }) }));
    vi.stubGlobal("fetch", fetchMock);

    await sendIntervention("tid-1", "Prioritise the report", "http://api");

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("http://api/debate/tid-1/intervene");
    expect(JSON.parse(init.body as string)).toEqual({ input: "Prioritise the report" });
  });
});

describe("streamUrl", () => {
  it("builds the SSE URL for a thread", () => {
    expect(streamUrl("tid-1", "http://api")).toBe("http://api/debate/tid-1/stream");
  });
});

describe("exportIcs", () => {
  it("POSTs blocks and returns a blob", async () => {
    const blob = new Blob(["BEGIN:VCALENDAR"], { type: "text/calendar" });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, blob: async () => blob });
    vi.stubGlobal("fetch", fetchMock);
    const out = await exportIcs("2026-06-15T00:00:00", [], "Australia/Sydney", "http://api");
    expect(fetchMock).toHaveBeenCalledWith(
      "http://api/calendar/ics/export",
      expect.objectContaining({ method: "POST" }),
    );
    expect(out).toBe(blob);
  });
});
