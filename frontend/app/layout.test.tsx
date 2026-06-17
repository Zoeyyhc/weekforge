import { describe, expect, it, vi } from "vitest";
import RootLayout from "./layout";

vi.mock("next/font/google", () => ({
  Fraunces: () => ({ variable: "font-display" }),
  Hanken_Grotesk: () => ({ variable: "font-sans" }),
  JetBrains_Mono: () => ({ variable: "font-mono" }),
}));

describe("RootLayout", () => {
  it("suppresses unavoidable browser-injected html attribute mismatches", () => {
    const layout = RootLayout({ children: <main>Content</main> });

    expect(layout.props.suppressHydrationWarning).toBe(true);
  });
});
