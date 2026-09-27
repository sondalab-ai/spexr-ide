const KEY = "spexr.darkfactory.scheduleSidebar";
export const SIDEBAR_MIN = 280;
export const SIDEBAR_MAX = 560;
const DEFAULT: SidebarPrefs = { open: true, width: 340 };

export interface SidebarPrefs {
  open: boolean;
  width: number;
}
interface PrefStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const clamp = (w: number): number => Math.min(SIDEBAR_MAX, Math.max(SIDEBAR_MIN, Math.round(w)));

/** The sidebar's open state and width for this window; defaults on anything unreadable. */
export function readSidebarPrefs(storage: PrefStorage): SidebarPrefs {
  try {
    const raw = JSON.parse(storage.getItem(KEY) ?? "null") as Partial<SidebarPrefs> | null;
    if (!raw || typeof raw !== "object") return DEFAULT;
    return {
      open: typeof raw.open === "boolean" ? raw.open : DEFAULT.open,
      width: typeof raw.width === "number" && Number.isFinite(raw.width) ? clamp(raw.width) : DEFAULT.width,
    };
  } catch {
    return DEFAULT;
  }
}

export function writeSidebarPrefs(storage: PrefStorage, prefs: SidebarPrefs): void {
  try {
    storage.setItem(KEY, JSON.stringify({ open: prefs.open, width: clamp(prefs.width) }));
  } catch {
    /* storage blocked: the preference is a convenience */
  }
}
