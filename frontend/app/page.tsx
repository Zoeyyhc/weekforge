import { ForgeBackground } from "@/components/landing/ForgeBackground";
import { Hero } from "@/components/landing/Hero";
import { Champions } from "@/components/landing/Champions";
import { HowItWorks } from "@/components/landing/HowItWorks";
import { FinalCTA } from "@/components/landing/FinalCTA";

// WeekForge landing page. Atmospheric forge backdrop + a sequence of sections
// introducing the council, the four champions, and the live-debate mechanic.
export default function LandingPage() {
  return (
    <main className="relative">
      <ForgeBackground />
      <Hero />
      <Champions />
      <HowItWorks />
      <FinalCTA />
    </main>
  );
}
