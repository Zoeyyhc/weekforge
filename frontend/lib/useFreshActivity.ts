"use client";

import { useEffect, useState } from "react";

/**
 * Tracks whether activity is "live" right now.
 *
 * Debate events arrive in bursts; between bursts the council works silently
 * (convergence-check, arbitration) with no events. Tying a "now speaking"
 * indicator to the latest event alone makes the last burst's speaker look
 * frozen. This hook returns true each time `count` increases and fades to
 * false after `windowMs` of no further increase, so callers can drop the
 * "speaking…" claim during the silent gap.
 */
export function useFreshActivity(count: number, windowMs: number = 3000): boolean {
  const [fresh, setFresh] = useState(false);

  useEffect(() => {
    if (count <= 0) {
      setFresh(false);
      return;
    }
    setFresh(true);
    const timer = setTimeout(() => setFresh(false), windowMs);
    return () => clearTimeout(timer);
  }, [count, windowMs]);

  return fresh;
}
