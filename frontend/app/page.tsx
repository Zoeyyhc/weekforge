import { ForgeBackground } from "@/components/landing/ForgeBackground";
import { Hero } from "@/components/landing/Hero";
import { Champions } from "@/components/landing/Champions";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { FinalCTA } from "@/components/landing/FinalCTA";
import { ForgeLogo } from "@/components/ForgeLogo";

// WeekForge landing page. Atmospheric forge backdrop + a sequence of sections
// introducing the council, the four champions, and the live-debate mechanic.
export default function LandingPage() {
  return (
    <main className="relative">
      <ForgeBackground />

      {/* Minimal brand nav — the same sigil lockup the app header uses. */}
      <nav className="animate-forge-in absolute inset-x-0 top-0 z-20 flex items-center justify-between px-6 py-6 sm:px-10">
        <ForgeLogo size="md" href="/" />
        <a
          href="/app"
          className="rounded-full border border-border px-5 py-2 text-xs font-medium text-foreground/80 transition-colors hover:border-amber/50 hover:text-foreground"
        >
          Open the app
        </a>
      </nav>

      <Hero />
      <Champions />
      <HowItWorks />
      <FinalCTA />
    </main>
  );
}
