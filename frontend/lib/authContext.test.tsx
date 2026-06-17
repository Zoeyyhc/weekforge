import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AuthProvider, useAuth } from "@/lib/authContext";
import * as authApi from "@/lib/auth";

beforeEach(() => {
  localStorage.clear();
});

afterEach(() => {
  localStorage.clear();
  vi.restoreAllMocks();
});

const wrapper = ({ children }: { children: React.ReactNode }) => (
  <AuthProvider>{children}</AuthProvider>
);

describe("useAuth", () => {
  it("starts anon when no token", async () => {
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("anon"));
    expect(result.current.user).toBeNull();
    expect(result.current.token).toBeNull();
  });

  it("hydrates user from stored token", async () => {
    localStorage.setItem("weekforge.token", "t1");
    vi.spyOn(authApi, "fetchMe").mockResolvedValue({
      user: { id: "u1", email: "a@b.com", display_name: "Ada" },
      preferences: null,
    });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("authed"));
    expect(result.current.user?.display_name).toBe("Ada");
    expect(result.current.token).toBe("t1");
  });

  it("signIn stores token in context", async () => {
    vi.spyOn(authApi, "login").mockResolvedValue({
      token: "t2",
      user: { id: "u2", email: "b@c.com", display_name: "Bea" },
    });

    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("anon"));

    await act(async () => {
      await result.current.signIn("b@c.com", "pw");
    });

    expect(result.current.status).toBe("authed");
    expect(result.current.user?.display_name).toBe("Bea");
    expect(result.current.token).toBe("t2");
    expect(localStorage.getItem("weekforge.token")).toBe("t2");
  });

  it("signOut clears user and token", async () => {
    localStorage.setItem("weekforge.token", "t1");
    vi.spyOn(authApi, "fetchMe").mockResolvedValue({
      user: { id: "u1", email: "a@b.com", display_name: "Ada" },
      preferences: null,
    });
    const { result } = renderHook(() => useAuth(), { wrapper });
    await waitFor(() => expect(result.current.status).toBe("authed"));
    act(() => result.current.signOut());
    expect(result.current.status).toBe("anon");
    expect(result.current.token).toBeNull();
    expect(localStorage.getItem("weekforge.token")).toBeNull();
  });
});
