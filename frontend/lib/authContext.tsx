"use client";

import { createContext, useContext, useEffect, useState } from "react";
import {
  clearToken,
  fetchMe,
  getToken,
  login as loginApi,
  setToken,
  signup as signupApi,
  type User,
} from "@/lib/auth";

type Status = "loading" | "authed" | "anon";

interface AuthValue {
  token: string | null;
  user: User | null;
  status: Status;
  signIn: (email: string, password: string) => Promise<void>;
  register: (email: string, password: string, displayName: string) => Promise<void>;
  signOut: () => void;
}

const AuthContext = createContext<AuthValue | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [token, setAuthToken] = useState<string | null>(null);
  const [user, setUser] = useState<User | null>(null);
  const [status, setStatus] = useState<Status>("loading");

  useEffect(() => {
    const storedToken = getToken();
    if (!storedToken) {
      setStatus("anon");
      return;
    }

    setAuthToken(storedToken);

    fetchMe(storedToken)
      .then((res) => {
        setUser(res.user);
        setStatus("authed");
      })
      .catch(() => {
        clearToken();
        setAuthToken(null);
        setUser(null);
        setStatus("anon");
      });
  }, []);

  const signIn = async (email: string, password: string) => {
    const { token, user } = await loginApi(email, password);
    setToken(token);
    setAuthToken(token);
    setUser(user);
    setStatus("authed");
  };

  const register = async (email: string, password: string, displayName: string) => {
    const { token, user } = await signupApi(email, password, displayName);
    setToken(token);
    setAuthToken(token);
    setUser(user);
    setStatus("authed");
  };

  const signOut = () => {
    clearToken();
    setAuthToken(null);
    setUser(null);
    setStatus("anon");
  };

  return (
    <AuthContext.Provider value={{ token, user, status, signIn, register, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (ctx === null) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
