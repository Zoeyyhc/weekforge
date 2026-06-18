"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import { ForgeBackground } from "@/components/landing/ForgeBackground";
import { ForgeLogo } from "@/components/ForgeLogo";
import { useAuth } from "@/lib/authContext";

type Mode = "login" | "signup";

const INPUT_CLASS =
  "w-full rounded-lg border border-[#272430] bg-surface/60 px-4 py-2.5 text-foreground outline-none backdrop-blur-sm transition-colors placeholder:text-muted/60 focus:border-ember";

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

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError(null);

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

  return (
    <main className="relative grid min-h-dvh overflow-hidden px-6 py-8">
      <ForgeBackground />

      <section className="relative z-10 m-auto w-full max-w-[28rem]">
        <div className="mb-8 flex justify-center">
          <ForgeLogo size="md" href="/" />
        </div>

        <div className="relative overflow-hidden rounded-2xl border border-[#272430] bg-surface/60 p-6 shadow-[0_20px_80px_rgba(0,0,0,0.28)] backdrop-blur-sm sm:p-8">
          <div aria-hidden className="forge-mesh animate-mesh-drift absolute inset-0 opacity-30" />

          <div className="relative">
            <p className="font-mono text-[10px] uppercase tracking-[0.34em] text-amber/80">
              {mode === "signup" ? "Claim your seat" : "Return to the forge"}
            </p>
            <h1 className="mt-2 font-display text-3xl font-light leading-tight tracking-tight text-foreground sm:text-[2.4rem]">
              {mode === "signup" ? "Join the council" : "Enter the forge"}
            </h1>
            <p className="mt-3 max-w-[28ch] text-sm leading-relaxed text-muted">
              {mode === "signup"
                ? "Create a local account and step into the council."
                : "Use your local account to open the forge."}
            </p>

            <form onSubmit={onSubmit} className="mt-7 flex flex-col gap-4">
              {mode === "signup" && (
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
                    autoComplete={mode === "signup" ? "new-password" : "current-password"}
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
                className="mt-2 inline-flex items-center justify-center rounded-full bg-ember px-5 py-2.5 text-sm font-semibold text-background transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {mode === "signup" ? "Claim a seat" : "Enter the forge"}
              </button>
            </form>

            <button
              type="button"
              onClick={() => {
                setMode((current) => (current === "login" ? "signup" : "login"));
                setError(null);
              }}
              className="mt-5 text-xs leading-relaxed text-muted transition-colors hover:text-amber"
            >
              {mode === "login"
                ? "Claim a seat at the council."
                : "Already sworn in? Return to the forge."}
            </button>
          </div>
        </div>
      </section>
    </main>
  );
}
