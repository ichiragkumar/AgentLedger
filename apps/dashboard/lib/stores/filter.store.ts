import { create } from "zustand";

export type DateRange = "24h" | "7d" | "30d";

type FilterState = {
  range: DateRange;
  agent: string | null;
  team: string | null;
  model: string | null;
  setRange: (range: DateRange) => void;
  setAgent: (agent: string | null) => void;
  setTeam: (team: string | null) => void;
  setModel: (model: string | null) => void;
  reset: () => void;
};

const initial = { range: "24h" as DateRange, agent: null, team: null, model: null };

/** Global date-range + attribution filters (spec 17 data layer). */
export const useFilterStore = create<FilterState>()((set) => ({
  ...initial,
  setRange: (range) => set({ range }),
  setAgent: (agent) => set({ agent }),
  setTeam: (team) => set({ team }),
  setModel: (model) => set({ model }),
  reset: () => set({ ...initial }),
}));
