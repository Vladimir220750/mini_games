"use client";

import { MatchStatus } from "@packages/shared";
import { create } from "zustand";

interface RpsState {
  wallet: string | null;
  matchId: string | null;
  status: MatchStatus | null;
  log: string[];
  setWallet: (wallet: string | null) => void;
  setMatchId: (id: string | null) => void;
  setStatus: (status: MatchStatus | null) => void;
  addLog: (entry: string) => void;
  reset: () => void;
}

export const useRpsStore = create<RpsState>((set) => ({
  wallet: null,
  matchId: null,
  status: null,
  log: [],
  setWallet: (wallet) => set({ wallet }),
  setMatchId: (id) => set({ matchId: id }),
  setStatus: (status) => set({ status }),
  addLog: (entry) => set((state) => ({ log: [...state.log, entry] })),
  reset: () => set({ matchId: null, status: null, log: [] }),
}));
