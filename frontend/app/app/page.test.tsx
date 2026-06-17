import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mockUseDebateStream = vi.fn();
const mockUseAuth = vi.fn();
const startSpy = vi.fn();
const interveneSpy = vi.fn();
const resetSpy = vi.fn();
const signOutSpy = vi.fn();
const push = vi.fn();

vi.mock("@/lib/useDebateStream", () => ({
  useDebateStream: () => mockUseDebateStream(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("@/lib/authContext", () => ({
  useAuth: () => mockUseAuth(),
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

async function loadHome() {
  return (await import("@/app/app/page")).default;
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.resetModules();
  mockUseDebateStream.mockReturnValue({
    state: { status: "idle", events: [], schedule: null, error: null, interrupt: null },
    maxRounds: 3,
    start: startSpy,
    intervene: interveneSpy,
    reset: resetSpy,
  });
  mockUseAuth.mockReturnValue({
    user: { id: "u1", email: "a@b.com", display_name: "Ada" },
    status: "authed",
    signOut: signOutSpy,
  });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("Home page", () => {
  it("redirects to /login when unauthenticated", async () => {
    mockUseAuth.mockReturnValue({
      user: null,
      status: "anon",
      signOut: vi.fn(),
    });
    const Home = await loadHome();

    render(<Home />);

    await waitFor(() => expect(push).toHaveBeenCalledWith("/login"));
  });

  it("always shows the task form without a login gate", async () => {
    const Home = await loadHome();

    render(<Home />);

    expect(screen.getByTestId("task-form")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /sign in with google/i })).not.toBeInTheDocument();
  });

  it("shows the display name and lets the user leave the forge", async () => {
    const Home = await loadHome();

    render(<Home />);

    expect(screen.getByText("Ada")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Leave the forge" }));

    expect(signOutSpy).toHaveBeenCalledTimes(1);
  });

  it("passes the current week start to TaskForm", async () => {
    const Home = await loadHome();

    render(<Home />);

    expect(screen.getByTestId("selected-week")).toHaveTextContent("2026-06-");
  });

  it("updates the displayed week when onWeekChange is called", async () => {
    const Home = await loadHome();

    render(<Home />);

    fireEvent.click(screen.getByRole("button", { name: /pick next week/i }));

    expect(screen.getByTestId("selected-week")).toHaveTextContent("2026-06-22");
  });

  it("starts the debate with the current week_start and no busy blocks", async () => {
    const Home = await loadHome();

    render(<Home />);

    fireEvent.click(screen.getByRole("button", { name: /start debate/i }));

    expect(startSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        week_start: expect.stringContaining("2026-06-"),
        busy_blocks: [],
      }),
    );
  });

  it("pops the Herald modal when the debate interrupts for a vote", async () => {
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
    const Home = await loadHome();

    render(<Home />);

    expect(screen.getByText("The Herald")).toBeInTheDocument();
  });
});
