import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, waitFor, fireEvent } from "@testing-library/react";
import Home from "./page";

const mockUseGoogleCalendar = vi.fn();
const mockUseDebateStream = vi.fn();
const startSpy = vi.fn();
const importWeekSpy = vi.fn();
const loadCalendarsSpy = vi.fn();
const disconnectSpy = vi.fn();
const toggleCalendarSpy = vi.fn();
const interveneSpy = vi.fn();
const resetSpy = vi.fn();

vi.mock("@/lib/useGoogleCalendar", () => ({
  useGoogleCalendar: () => mockUseGoogleCalendar(),
}));

vi.mock("@/lib/useDebateStream", () => ({
  useDebateStream: () => mockUseDebateStream(),
}));

vi.mock("@/lib/useFreshActivity", () => ({
  useFreshActivity: () => false,
}));

vi.mock("@/lib/debateProgress", () => ({
  debateProgress: () => ({ roster: [] }),
}));

vi.mock("@/components/TaskForm", () => ({
  TaskForm: ({
    weekStart,
    onWeekChange,
    onStart,
    googleSlot,
  }: {
    weekStart: string;
    onWeekChange: (week: string) => void;
    onStart: (req: { tasks: never[]; busy_blocks: never[] }) => void;
    googleSlot: React.ReactNode;
  }) => (
    <div data-testid="task-form">
      <div data-testid="selected-week">{weekStart}</div>
      <button type="button" onClick={() => onWeekChange("2026-06-22")}>
        Pick next week
      </button>
      <button type="button" onClick={() => onStart({ tasks: [], busy_blocks: [] })}>
        Start debate
      </button>
      {googleSlot}
    </div>
  ),
}));

vi.mock("@/components/ImportPreview", () => ({
  ImportPreview: ({ blocks }: { blocks: Array<{ label: string }> }) => (
    <div data-testid="import-preview">{blocks.map((block) => block.label).join(",")}</div>
  ),
}));

vi.mock("@/components/ForgeLogo", () => ({ ForgeLogo: () => <div>ForgeLogo</div> }));
vi.mock("@/components/AppAtmosphere", () => ({ AppAtmosphere: () => null }));
vi.mock("@/components/ForgedModal", () => ({ ForgedModal: () => null }));
vi.mock("@/components/DebateTimeline", () => ({ DebateTimeline: () => null }));
vi.mock("@/components/DebateStatusBand", () => ({ DebateStatusBand: () => null }));
vi.mock("@/components/CouncilRoster", () => ({ CouncilRoster: () => null }));
vi.mock("@/components/InterventionPanel", () => ({ InterventionPanel: () => null }));
vi.mock("@/components/WeekCalendar", () => ({ WeekCalendar: () => null }));
vi.mock("@/components/ExportButton", () => ({ ExportButton: () => null }));
vi.mock("@/components/GoogleConnect", () => ({ GoogleConnect: () => <div>GoogleConnect</div> }));
vi.mock("@/components/CalendarPicker", () => ({ CalendarPicker: () => <div>CalendarPicker</div> }));

vi.mock("@/lib/api", () => ({
  googleLoginUrl: () => "/auth/google/login",
  exportSchedule: vi.fn(),
}));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockUseDebateStream.mockReturnValue({
    state: { status: "idle", events: [], schedule: null, error: null, interrupt: null },
    maxRounds: 3,
    start: startSpy,
    intervene: interveneSpy,
    reset: resetSpy,
  });
  mockUseGoogleCalendar.mockReturnValue({
    connected: true,
    statusKnown: true,
    calendars: [{ id: "primary", summary: "Primary", selected_by_default: true }],
    selectedIds: ["primary"],
    loadCalendars: loadCalendarsSpy,
    toggleCalendar: toggleCalendarSpy,
    importWeek: importWeekSpy,
    disconnect: disconnectSpy,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Home page", () => {
  it("shows the login screen when not connected", () => {
    mockUseGoogleCalendar.mockReturnValue({
      connected: false,
      statusKnown: true,
      calendars: [],
      selectedIds: [],
      loadCalendars: loadCalendarsSpy,
      toggleCalendar: toggleCalendarSpy,
      importWeek: importWeekSpy,
      disconnect: disconnectSpy,
    });

    render(<Home />);

    expect(screen.getByRole("link", { name: /sign in with google/i })).toBeInTheDocument();
    expect(screen.queryByTestId("task-form")).not.toBeInTheDocument();
  });

  it("shows the task form when connected", () => {
    render(<Home />);

    expect(screen.getByTestId("task-form")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /sign in with google/i })).not.toBeInTheDocument();
  });

  it("renders nothing while status is loading", () => {
    mockUseGoogleCalendar.mockReturnValue({
      connected: false,
      statusKnown: false,
      calendars: [],
      selectedIds: [],
      loadCalendars: loadCalendarsSpy,
      toggleCalendar: toggleCalendarSpy,
      importWeek: importWeekSpy,
      disconnect: disconnectSpy,
    });

    const { container } = render(<Home />);

    expect(container).toBeEmptyDOMElement();
  });

  it("clears imported blocks when the selected week changes", async () => {
    importWeekSpy.mockResolvedValue([
      { start: "2026-06-15T01:00:00Z", end: "2026-06-15T02:00:00Z", label: "Week A", task_id: null },
    ]);
    render(<Home />);

    fireEvent.click(screen.getByRole("button", { name: /import this week/i }));
    await waitFor(() => expect(screen.getByTestId("import-preview")).toHaveTextContent("Week A"));

    fireEvent.click(screen.getByRole("button", { name: /pick next week/i }));

    await waitFor(() => expect(screen.queryByTestId("import-preview")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /start debate/i }));
    expect(startSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        week_start: "2026-06-22",
        busy_blocks: [],
      }),
    );
  });

  it("ignores stale import results after the picker moves to another week", async () => {
    const inFlight = deferred<
      Array<{ start: string; end: string; label: string; task_id: null }>
    >();
    importWeekSpy.mockReturnValue(inFlight.promise);
    render(<Home />);

    fireEvent.click(screen.getByRole("button", { name: /import this week/i }));
    expect(importWeekSpy).toHaveBeenCalledWith(expect.stringContaining("2026-06-15T00:00:00"));

    fireEvent.click(screen.getByRole("button", { name: /pick next week/i }));
    inFlight.resolve([
      { start: "2026-06-15T03:00:00Z", end: "2026-06-15T04:00:00Z", label: "Stale Week A", task_id: null },
    ]);

    await waitFor(() => expect(screen.getByTestId("selected-week")).toHaveTextContent("2026-06-22"));
    await waitFor(() => expect(screen.queryByTestId("import-preview")).not.toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: /start debate/i }));
    expect(startSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        week_start: "2026-06-22",
        busy_blocks: [],
      }),
    );
  });
});
