import type { Metadata } from "next";
import { Fraunces, Hanken_Grotesk, JetBrains_Mono } from "next/font/google";
import "./globals.css";
import "react-big-calendar/lib/css/react-big-calendar.css";

// Display: an editorial, high-contrast serif with optical sizing and an
// expressive italic — used for headlines and the "forged" wordmark.
const fraunces = Fraunces({
  variable: "--font-display",
  subsets: ["latin"],
  style: ["normal", "italic"],
  axes: ["opsz", "SOFT"],
});

// Body/UI: a clean, slightly warm grotesque that pairs with Fraunces.
const hanken = Hanken_Grotesk({
  variable: "--font-sans",
  subsets: ["latin"],
});

// Mono: time values, JSON, code-like detail across the app.
const jetbrains = JetBrains_Mono({
  variable: "--font-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "WeekForge — Your week, forged in debate",
  description:
    "A transparent council of AI agents argues, live, over how to plan your week. Watch them debate — then step in as the final arbiter.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${fraunces.variable} ${hanken.variable} ${jetbrains.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="min-h-full flex flex-col" suppressHydrationWarning>{children}</body>
    </html>
  );
}
