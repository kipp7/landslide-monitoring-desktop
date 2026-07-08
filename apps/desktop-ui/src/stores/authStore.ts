import { create } from "zustand";
import { persist } from "zustand/middleware";

import type { User } from "../api/client";

type AuthState = {
  token: string | null;
  refreshToken: string | null;
  user: User | null;
  setSession: (input: { token: string; refreshToken?: string; user: User }) => void;
  setTokens: (input: { token: string; refreshToken?: string | null }) => void;
  clear: () => void;
};

export const useAuthStore = create<AuthState>()(
  persist(
    (set) => ({
      token: null,
      refreshToken: null,
      user: null,
      setSession: ({ token, refreshToken, user }) => {
        set({ token, refreshToken: refreshToken ?? null, user });
      },
      setTokens: ({ token, refreshToken }) => {
        set((prev) => ({ token, refreshToken: refreshToken ?? prev.refreshToken, user: prev.user }));
      },
      clear: () => {
        set({ token: null, refreshToken: null, user: null });
      }
    }),
    { name: "desk_auth_v1" }
  )
);
