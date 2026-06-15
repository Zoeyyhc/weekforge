import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { GoogleConnect } from "@/components/GoogleConnect";

describe("GoogleConnect", () => {
  it("shows a connect link when disconnected", () => {
    render(<GoogleConnect connected={false} loginUrl="http://api/auth/google/login" disconnectUrl="http://api/auth/google/disconnect" />);
    const link = screen.getByRole("link", { name: /bind your google calendar/i });
    expect(link).toHaveAttribute("href", "http://api/auth/google/login");
  });

  it("shows the bound seal and an unbind action when connected", () => {
    render(<GoogleConnect connected={true} loginUrl="http://api/auth/google/login" disconnectUrl="http://api/auth/google/disconnect" />);
    expect(screen.getByText(/calendar bound/i)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /unbind/i })).toHaveAttribute(
      "href", "http://api/auth/google/disconnect",
    );
  });
});
