import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";

const push = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push }) }));

const signIn = vi.fn().mockResolvedValue(undefined);
const register = vi.fn().mockResolvedValue(undefined);
vi.mock("@/lib/authContext", () => ({
  useAuth: () => ({ user: null, status: "anon", signIn, register, signOut: vi.fn() }),
}));

import LoginPage from "@/app/login/page";

describe("LoginPage", () => {
  beforeEach(() => {
    push.mockReset();
    signIn.mockReset().mockResolvedValue(undefined);
    register.mockReset().mockResolvedValue(undefined);
  });

  it("logs in and redirects to /app", async () => {
    const user = userEvent.setup();

    render(<LoginPage />);

    await user.type(screen.getByLabelText(/email/i), "a@b.com");
    await user.type(screen.getByLabelText(/password/i), "pw");
    await user.click(screen.getByRole("button", { name: /enter|convene|sign in/i }));

    expect(signIn).toHaveBeenCalledWith("a@b.com", "pw");
    expect(push).toHaveBeenCalledWith("/app");
  });

  it("shows the display-name field after switching to signup", async () => {
    const user = userEvent.setup();

    render(<LoginPage />);

    await user.click(screen.getByRole("button", { name: /claim a seat|sign up|create/i }));

    expect(screen.getByLabelText(/name/i)).toBeInTheDocument();
  });

  it("toggles password visibility", async () => {
    const user = userEvent.setup();

    render(<LoginPage />);

    const password = screen.getByLabelText(/password/i);
    expect(password).toHaveAttribute("type", "password");

    await user.click(screen.getByRole("button", { name: /show/i }));
    expect(password).toHaveAttribute("type", "text");

    await user.click(screen.getByRole("button", { name: /hide/i }));
    expect(password).toHaveAttribute("type", "password");
  });

  it("submits signup with the display name and redirects to /app", async () => {
    const user = userEvent.setup();

    render(<LoginPage />);

    await user.click(screen.getByRole("button", { name: /claim a seat|sign up|create/i }));
    await user.type(screen.getByLabelText(/name/i), "Ada");
    await user.type(screen.getByLabelText(/email/i), "ada@example.com");
    await user.type(screen.getByLabelText(/password/i), "pw");
    await user.click(screen.getByRole("button", { name: /claim a seat/i }));

    expect(register).toHaveBeenCalledWith("ada@example.com", "pw", "Ada");
    expect(push).toHaveBeenCalledWith("/app");
  });
});
