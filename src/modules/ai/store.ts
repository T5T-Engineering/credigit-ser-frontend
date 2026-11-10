"use client";

/** AI console store: query history, saved/scheduled queries and AI-output sign-offs (prototype persistence). */
import { create } from "zustand";
import { createJSONStorage, persist } from "zustand/middleware";
import { getRule } from "@/lib/platform/rules";

export type QueryRecord = { id: string; question: string; askedAt: string; askedBy: string; askedById?: string; roleId: string; intent: string; status: "answered" | "refused" | "unknown"; reason?: string };
/** `cadence` is one of the `ai.schedule.cadences` rule values. */
export type SavedQuery = { id: string; question: string; cadence: string; createdBy: string; createdAt: string; recipients: string };
export type SignOff = { status: "Signed off" | "Rejected"; by: string; at: string };

type AiState = {
  history: QueryRecord[];
  saved: SavedQuery[];
  signOffs: Record<string, SignOff>;
  addQuery: (q: QueryRecord) => void;
  /** Conversation shows history after this query id ("New conversation"); the query log keeps everything. */
  conversationAfter?: string;
  newConversation: () => void;
  saveQuery: (q: SavedQuery) => void;
  removeSaved: (id: string) => void;
  signOff: (id: string, s: SignOff) => void;
};

export const useAi = create<AiState>()(
  persist(
    (set) => ({
      history: [],
      saved: [],
      signOffs: {},
      addQuery: (q) => set((s) => ({ history: [...s.history, q].slice(-getRule<number>("ai.queryLog.maxEntries")) })),
      newConversation: () => set((s) => ({ conversationAfter: s.history[s.history.length - 1]?.id })),
      saveQuery: (q) => set((s) => ({ saved: [q, ...s.saved] })),
      removeSaved: (id) => set((s) => ({ saved: s.saved.filter((x) => x.id !== id) })),
      signOff: (id, so) => set((s) => ({ signOffs: { ...s.signOffs, [id]: so } })),
    }),
    { name: "credigit.ser.ai", version: 1, storage: createJSONStorage(() => localStorage) },
  ),
);
