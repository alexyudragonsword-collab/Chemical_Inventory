// Appearance (visual theme) system. Purely cosmetic: the choice lives in a
// browser cookie and switches CSS tokens only — business data is never
// copied, migrated or cleared by changing it.

export const APPEARANCE_COOKIE = "chemtrack-appearance";

export const APPEARANCES = [
  { id: "default", label: "ChemTrack" },
  { id: "glass", label: "Liquid Glass" },
  { id: "notion", label: "Notion" },
  { id: "brutal", label: "Neo-Brutalism" },
] as const;

export type AppearanceId = (typeof APPEARANCES)[number]["id"];

export function normalizeAppearance(value: string | undefined): AppearanceId {
  return (APPEARANCES.some((a) => a.id === value) ? value : "default") as AppearanceId;
}
