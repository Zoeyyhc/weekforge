import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mockUseDebateStream = vi.fn();
const mockUseAuth = vi.fn();
const startSpy = vi.fn();
const interveneSpy = vi.fn();
const resetSpy = vi.fn();
const signOutSpy = vi.fn();
const push = vi.fn();
const fetchMeSpy = vi.fn();
const savePreferencesSpy = vi.fn();

vi.mock("@/lib/useDebateStream", () => ({
  useDebateStream: () => mockUseDebateStream(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push }),
}));

vi.mock("@/lib/authContext", () => ({
  useAuth: () => mockUseAuth(),
}));

vi.mock("@/lib/auth", () => ({
  fetchMe: (token: string) => fetchMeSpy(token),
  savePreferences: (
    token: string,
    prefs: {
      workday_start_hour: number;
      workday_end_hour: number;
      max_focus_minutes_per_day: number;
      timezone: string | null;
    },
  ) => savePreferencesSpy(token, prefs),
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
    initialPrefs,
  }: {
    weekStart: string;
    onWeekChange: (week: string) => void;
    onStart: (req: {
      tasks: never[];
      busy_blocks: never[];
      preferences?: {
        workday_start_hour: number;
        workday_end_hour: number;
        max_focus_minutes_per_day: number;
        timezone: string | null;
      };
    }) => void;
    initialPrefs?: {
      workdayStartHour: string;
      workdayEndHour: string;
      maxFocusMinutes: string;
      timezone?: string | null;
    };
  }) => (
    <div data-testid="task-form">
      <div data-testid="selected-week">{weekStart}</div>
      <div data-testid="initial-pref-start">{initialPrefs?.workdayStartHour ?? "none"}</div>
      <div data-testid="initial-pref-end">{initialPrefs?.workdayEndHour ?? "none"}</div>
      <div data-testid="initial-pref-focus">{initialPrefs?.maxFocusMinutes ?? "none"}</div>
      <div data-testid="initial-pref-timezone">{initialPrefs?.timezone ?? "none"}</div>
      <button type="button" onClick={() => onWeekChange("2026-06-22")}>
        Pick next week
      </button>
      <button
        type="button"
        onClick={() =>
          onStart({
            tasks: [],
            busy_blocks: [],
            preferences: {
              workday_start_hour: 8,
              workday_end_hour: 16,
              max_focus_minutes_per_day: 240,
              timezone: "Australia/Melbourne",
            },
          })
        }
      >
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
    token: null,
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
      token: null,
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

  it("loads saved rhythm preferences and passes them to TaskForm", async () => {
    mockUseAuth.mockReturnValue({
      token: "tok-1",
      user: { id: "u1", email: "a@b.com", display_name: "Ada" },
      status: "authed",
      signOut: signOutSpy,
    });
    fetchMeSpy.mockResolvedValue({
      user: { id: "u1", email: "a@b.com", display_name: "Ada" },
      preferences: {
        workday_start_hour: 7,
        workday_end_hour: 15,
        max_focus_minutes_per_day: 240,
        timezone: "Australia/Melbourne",
      },
    });
    const Home = await loadHome();

    render(<Home />);

    await waitFor(() => expect(fetchMeSpy).toHaveBeenCalledWith("tok-1"));
    expect(await screen.findByTestId("initial-pref-start")).toHaveTextContent("7");
    expect(screen.getByTestId("initial-pref-end")).toHaveTextContent("15");
    expect(screen.getByTestId("initial-pref-focus")).toHaveTextContent("240");
    expect(screen.getByTestId("initial-pref-timezone")).toHaveTextContent(
      "Australia/Melbourne",
    );
  });

  it("clears saved rhythm when the current account has no preferences", async () => {
    let authState = {
      token: "tok-1",
      user: { id: "u1", email: "a@b.com", display_name: "Ada" },
      status: "authed",
      signOut: signOutSpy,
    };
    mockUseAuth.mockImplementation(() => authState);
    fetchMeSpy
      .mockResolvedValueOnce({
        user: { id: "u1", email: "a@b.com", display_name: "Ada" },
        preferences: {
          workday_start_hour: 7,
          workday_end_hour: 15,
          max_focus_minutes_per_day: 240,
          timezone: "Australia/Melbourne",
        },
      })
      .mockResolvedValueOnce({
        user: { id: "u2", email: "b@c.com", display_name: "Bea" },
        preferences: null,
      });
    const Home = await loadHome();
    const { rerender } = render(<Home />);

    expect(await screen.findByTestId("initial-pref-start")).toHaveTextContent("7");

    authState = {
      token: "tok-2",
      user: { id: "u2", email: "b@c.com", display_name: "Bea" },
      status: "authed",
      signOut: signOutSpy,
    };
    rerender(<Home />);

    await waitFor(() => expect(fetchMeSpy).toHaveBeenCalledWith("tok-2"));
    expect(await screen.findByTestId("initial-pref-start")).toHaveTextContent("none");
  });

  it("saves rhythm preferences with timezone when debate starts", async () => {
    mockUseAuth.mockReturnValue({
      token: "tok-1",
      user: { id: "u1", email: "a@b.com", display_name: "Ada" },
      status: "authed",
      signOut: signOutSpy,
    });
    fetchMeSpy.mockResolvedValue({
      user: { id: "u1", email: "a@b.com", display_name: "Ada" },
      preferences: null,
    });
    savePreferencesSpy.mockResolvedValue({
      workday_start_hour: 8,
      workday_end_hour: 16,
      max_focus_minutes_per_day: 240,
      timezone: "Australia/Melbourne",
    });
    const Home = await loadHome();

    render(<Home />);

    fireEvent.click(await screen.findByRole("button", { name: /start debate/i }));

    expect(savePreferencesSpy).toHaveBeenCalledWith("tok-1", {
      workday_start_hour: 8,
      workday_end_hour: 16,
      max_focus_minutes_per_day: 240,
      max_focus_minutes_per_block: 90,
      timezone: "Australia/Melbourne",
    });
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
