"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";

// Lightweight scroll-triggered reveal. Adds the `forge-in` entrance animation
// the first time the element scrolls into view. Dependency-free (no Motion lib).
// Reduced-motion safe: the animation collapses to an instant opacity flip, so
// content never gets stranded invisible.
export function Reveal({
  children,
  delay = 0,
  className = "",
  as: Tag = "div",
}: {
  children: ReactNode;
  delay?: number;
  className?: string;
  as?: "div" | "li" | "section";
}) {
  const ref = useRef<HTMLElement | null>(null);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          setShown(true);
          io.disconnect();
        }
      },
      { threshold: 0.18, rootMargin: "0px 0px -8% 0px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  return (
    <Tag
      // @ts-expect-error — ref typing across the union of tag names is fine here.
      ref={ref}
      className={`${shown ? "animate-forge-in" : ""} ${className}`}
      style={{ opacity: shown ? 1 : 0, animationDelay: `${delay}s` }}
    >
      {children}
    </Tag>
  );
}
