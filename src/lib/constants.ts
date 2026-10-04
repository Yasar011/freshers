import type { Settings, EventInfo } from "./types";

/** The single Main Admin. Must match database.rules.json and storage.rules. */
export const MAIN_ADMIN_EMAIL = (process.env.NEXT_PUBLIC_MAIN_ADMIN_EMAIL || "yasar.h@nift.ac.in").toLowerCase();

export const DEFAULT_EVENT_NAME = "Freshers 2026";

export const DEFAULT_SETTINGS: Settings = {
  criteria: {
    makeup: { label: "Makeup", max: 10, order: 1 },
    presentation: { label: "Presentation", max: 10, order: 2 },
    styling: { label: "Styling", max: 10, order: 3 },
    dressup: { label: "Dress-up", max: 10, order: 4 },
  },
  evaluatorCount: 10,
  totalDays: 3,
};

export function defaultEvent(totalDays = 3): EventInfo {
  const days: EventInfo["days"] = {};
  for (let i = 1; i <= totalDays; i++) days[`day${i}`] = { label: `Day ${i}`, status: "locked" };
  return { name: DEFAULT_EVENT_NAME, activeDay: "day1", totalDays, status: "active", days };
}
