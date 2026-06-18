"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ForgeBackground } from "@/components/landing/ForgeBackground";
import { ForgeLogo, ForgeSigil } from "@/components/ForgeLogo";
import { useAuth } from "@/lib/authContext";

type Mode = "login" | "signup";

const INPUT_CLASS =
  "w-full rounded-lg border border-[#272430] bg-surface/60 px-4 py-2.5 text-foreground outline-none backdrop-blur-sm transition-colors placeholder:text-muted/60 focus:border-ember";

// Embers drifting up off the anvil face — denser than the ambient field,
// seated near the base of the sigil so the metal looks freshly worked.
const FORGE_EMBERS = [
  { left: "38%", delay: "0s", dur: "6.5s", size: 3 },
  { left: "46%", delay: "1.8s", dur: "8s", size: 2 },
  { left: "53%", delay: "3.4s", dur: "7s", size: 4 },
  { left: "60%", delay: "0.9s", dur: "9s", size: 2 },
  { left: "44%", delay: "4.6s", dur: "6.8s", size: 3 },
  { left: "57%", delay: "2.7s", dur: "8.6s", size: 2 },
];

export default function LoginPage() {
  const router = useRouter();
  const { signIn, register } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [displayName, setDisplayName] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Bumped on every submit so the shockwave element remounts and replays.
  const [strikeKey, setStrikeKey] = useState(0);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);
    setStrikeKey((key) => key + 1);

    try {
      if (mode === "signup") {
        await register(email, password, displayName);
      } else {
        await signIn(email, password);
      }
      router.push("/app");
    } catch {
      setError(
        mode === "signup"
          ? "That email may already have a seat at the council."
          : "Email or password is wrong.",
      );
    } finally {
      setBusy(false);
    }
  }

  const isSignup = mode === "signup";

  return (
    <main className="relative min-h-dvh overflow-hidden">
      <ForgeBackground />

      {/* Shared mark pinned to the page, so both halves sit on one ground. */}
      <ForgeLogo
        size="md"
        href="/"
        className="absolute left-8 top-8 z-20 hidden lg:inline-flex xl:left-12 xl:top-12"
      />

      <div className="relative z-10 mx-auto grid min-h-dvh w-full max-w-5xl items-center gap-16 px-6 py-16 lg:grid-cols-2 lg:gap-24 lg:px-12">
        {/* ── The forge — a calm ambient presence; the atmosphere carries it. ── */}
        <section className="relative hidden flex-col lg:flex">
          {/* The anvil, seated in a breathing heat pool, with a striking spark. */}
          <div aria-hidden className="relative mb-12 h-32 w-32">
            <div
              className="animate-heat-breathe pointer-events-none absolute left-1/2 top-1/2 -z-10 h-[28rem] w-[28rem] -translate-x-1/2 -translate-y-1/2 rounded-full blur-3xl"
              style={{
                background:
                  "radial-gradient(circle, rgba(255,107,53,0.30), rgba(245,166,35,0.12) 45%, transparent 70%)",
              }}
            />
            <ForgeSigil
              decorative
              className="h-32 w-32 drop-shadow-[0_0_22px_rgba(255,107,53,0.45)]"
            />
            <span
              className="animate-anvil-strike absolute left-[70%] top-[8%] block h-3 w-3 rounded-full"
              style={{
                background:
                  "radial-gradient(circle, var(--amber), var(--ember) 60%, transparent)",
                boxShadow: "0 0 14px 3px rgba(245,166,35,0.7)",
              }}
            />
            {FORGE_EMBERS.map((e, i) => (
              <span
                key={i}
                className="absolute bottom-2 rounded-full"
                style={{
                  left: e.left,
                  width: e.size,
                  height: e.size,
                  background:
                    "radial-gradient(circle, var(--amber), var(--ember) 60%, transparent)",
                  boxShadow: "0 0 8px 1px rgba(255,107,53,0.6)",
                  animation: `ember-rise ${e.dur} linear ${e.delay} infinite`,
                }}
              />
            ))}
          </div>

          <p
            className="animate-forge-in font-mono text-[11px] uppercase tracking-[0.42em] text-amber/80"
            style={{ animationDelay: "0.05s" }}
          >
            {isSignup ? "A new hand at the anvil" : "The council reconvenes"}
          </p>
          <h2
            className="animate-forge-in mt-6 font-display text-[clamp(1.75rem,2.6vw,2.25rem)] font-light leading-[1.18] tracking-[-0.01em] text-foreground"
            style={{ animationDelay: "0.16s" }}
          >
            Step up to the{" "}
            <span
              className="italic"
              style={{
                background:
                  "linear-gradient(180deg, var(--amber), var(--ember) 70%)",
                WebkitBackgroundClip: "text",
                backgroundClip: "text",
                color: "transparent",
                textShadow: "0 0 50px rgba(255,107,53,0.22)",
              }}
            >
              anvil
            </span>
            .
          </h2>
          <p
            className="animate-forge-in mt-7 max-w-[32ch] text-sm leading-loose text-muted"
            style={{ animationDelay: "0.32s" }}
          >
            Four opinionated minds are waiting to argue your week into shape.
            Cross the threshold and convene them.
          </p>
        </section>

        {/* ── The work — quiet, disciplined. ── */}
        <section className="relative w-full">
          <div className="animate-forge-in mx-auto w-full max-w-sm lg:mx-0">
            {/* On mobile the forge half is hidden — give the form its mark. */}
            <div className="mb-10 flex justify-center lg:hidden">
              <ForgeLogo size="md" href="/" />
            </div>

            <p className="font-mono text-[10px] uppercase tracking-[0.34em] text-amber/80">
              {isSignup ? "Claim your seat" : "Return to the forge"}
            </p>
            <h1 className="mt-2 font-display text-3xl font-light leading-tight tracking-tight text-foreground sm:text-[2.4rem]">
              {isSignup ? "Join the council" : "Enter the forge"}
            </h1>

            <form onSubmit={onSubmit} className="mt-9 flex flex-col gap-5">
              {isSignup && (
                <label className="flex flex-col gap-1.5 text-sm text-muted">
                  Name
                  <input
                    className={INPUT_CLASS}
                    value={displayName}
                    onChange={(event) => setDisplayName(event.target.value)}
                    required
                    autoComplete="name"
                  />
                </label>
              )}

              <label className="flex flex-col gap-1.5 text-sm text-muted">
                Email
                <input
                  type="email"
                  className={INPUT_CLASS}
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                  required
                  autoComplete="email"
                />
              </label>

              <label className="flex flex-col gap-1.5 text-sm text-muted">
                Password
                <div className="relative">
                  <input
                    type={showPassword ? "text" : "password"}
                    className={`${INPUT_CLASS} pr-16`}
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    required
                    autoComplete={isSignup ? "new-password" : "current-password"}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((current) => !current)}
                    aria-pressed={showPassword}
                    className="absolute inset-y-0 right-3 my-auto h-fit font-mono text-[10px] uppercase tracking-[0.18em] text-muted transition-colors hover:text-amber"
                  >
                    {showPassword ? "Hide" : "Show"}
                  </button>
                </div>
              </label>

              {error && <p className="text-sm leading-relaxed text-hawk">{error}</p>}

              <button
                type="submit"
                disabled={busy}
                className="mt-2 inline-flex items-center justify-center rounded-full bg-ember px-5 py-2.5 text-sm font-semibold text-background shadow-[0_0_0_0_rgba(255,107,53,0.5)] transition-all duration-300 hover:shadow-[0_0_30px_3px_rgba(255,107,53,0.4)] disabled:cursor-not-allowed disabled:opacity-50 disabled:shadow-none"
              >
                {isSignup ? "Claim a seat" : "Enter the forge"}
              </button>
            </form>

            <button
              type="button"
              onClick={() => {
                setMode((current) => (current === "login" ? "signup" : "login"));
                setError(null);
              }}
              className="mt-6 text-xs leading-relaxed text-muted transition-colors hover:text-amber"
            >
              {mode === "login"
                ? "Claim a seat at the council."
                : "Already sworn in? Return to the forge."}
            </button>
          </div>
        </section>
      </div>

      {/* The strike: one ember shockwave the moment the threshold is crossed. */}
      {strikeKey > 0 && (
        <div
          key={strikeKey}
          aria-hidden
          className="animate-strike-flash pointer-events-none fixed left-1/2 top-1/2 -z-0 h-[60vmax] w-[60vmax] rounded-full"
          style={{
            background:
              "radial-gradient(circle, rgba(255,107,53,0.28), transparent 60%)",
          }}
        />
      )}
    </main>
  );
}
