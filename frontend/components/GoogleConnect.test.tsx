import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GoogleConnect } from "@/components/GoogleConnect";

describe("GoogleConnect", () => {
  it("shows a connect link when disconnected", () => {
    render(<GoogleConnect connected={false} loginUrl="http://api/auth/google/login" onDisconnect={vi.fn()} />);
    const link = screen.getByRole("link", { name: /bind your google calendar/i });
    expect(link).toHaveAttribute("href", "http://api/auth/google/login");
  });

  it("shows the bound seal when connected", () => {
    render(<GoogleConnect connected={true} loginUrl="http://api/auth/google/login" onDisconnect={vi.fn()} />);
    expect(screen.getByText(/calendar bound/i)).toBeInTheDocument();
  });

  it("unbind is a button (not a link) that calls onDisconnect", async () => {
    const onDisconnect = vi.fn();
    render(<GoogleConnect connected={true} loginUrl="http://api/auth/google/login" onDisconnect={onDisconnect} />);
    const btn = screen.getByRole("button", { name: /unbind/i });
    await userEvent.click(btn);
    expect(onDisconnect).toHaveBeenCalledOnce();
  });
});
