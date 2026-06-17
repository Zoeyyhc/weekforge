import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import Home from "./page";

const mockUseDebateStream = vi.fn();
const startSpy = vi.fn();
const interveneSpy = vi.fn();
const resetSpy = vi.fn();

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
  }: {
    weekStart: string;
    onWeekChange: (week: string) => void;
    onStart: (req: { tasks: never[]; busy_blocks: never[] }) => void;
  }) => (
    <div data-testid="task-form">
      <div data-testid="selected-week">{weekStart}</div>
      <button type="button" onClick={() => onWeekChange("2026-06-22")}>
        Pick next week
      </button>
      <button type="button" onClick={() => onStart({ tasks: [], busy_blocks: [] })}>
        Start debate
      </button>
    </div>
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

vi.mock("@/lib/api", () => ({
  exportIcs: vi.fn(),
}));

beforeEach(() => {
  vi.clearAllMocks();
  mockUseDebateStream.mockReturnValue({
    state: { status: "idle", events: [], schedule: null, error: null, interrupt: null },
    maxRounds: 3,
    start: startSpy,
    intervene: interveneSpy,
    reset: resetSpy,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Home page", () => {
  it("always shows the task form without a login gate", () => {
    render(<Home />);

    expect(screen.getByTestId("task-form")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /sign in with google/i })).not.toBeInTheDocument();
  });

  it("passes the current week start to TaskForm", () => {
    render(<Home />);

    expect(screen.getByTestId("selected-week")).toHaveTextContent("2026-06-");
  });

  it("updates the displayed week when onWeekChange is called", () => {
    render(<Home />);

    fireEvent.click(screen.getByRole("button", { name: /pick next week/i }));

    expect(screen.getByTestId("selected-week")).toHaveTextContent("2026-06-22");
  });

  it("starts the debate with the current week_start and no busy blocks", () => {
    render(<Home />);

    fireEvent.click(screen.getByRole("button", { name: /start debate/i }));

    expect(startSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        week_start: expect.stringContaining("2026-06-"),
        busy_blocks: [],
      }),
    );
  });

  it("pops the Herald modal when the debate interrupts for a vote", () => {
    mockUseDebateStream.mockReturnValue({
      state: {
        status: "interrupted",
        events: [],
        schedule: null,
        error: null,
        interrupt: {
          type: "interrupt",
          interrupt_reason: "The council stalled after 3 rounds.",
          proposals: { DeadlineHawk: "Front-load the deadline. Pack Monday." },
          thread_id: "t1",
        },
      },
      maxRounds: 3,
      start: startSpy,
      intervene: interveneSpy,
      reset: resetSpy,
    });

    render(<Home />);

    expect(screen.getByText("The Herald")).toBeInTheDocument();
  });
});
