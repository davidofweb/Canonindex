import { useSyncExternalStore } from "react";

export type ThemeId = "elysium" | "alabaster";

export type ThemeMeta = {
  id: ThemeId;
  label: string;
  shortLabel: string;
  isDark: boolean;
  canvasHex: string;
  surfaceHex: string;
  inkHex: string;
  stoneHex: string;
  lineHex: string;
  signalHex: string;
  forestHex: string;
  inkRgb: readonly [number, number, number];
  stoneRgb: readonly [number, number, number];
  signalRgb: readonly [number, number, number];
};

export const THEMES: ReadonlyArray<ThemeMeta> = [
  {
    id: "alabaster",
    label: "Light (Alabaster)",
    shortLabel: "Light",
    isDark: false,
    canvasHex: "#F6F5F0",
    surfaceHex: "#FDFCF9",
    inkHex: "#121512",
    stoneHex: "#5E645E",
    lineHex: "#E0DDD3",
    signalHex: "#059669",
    forestHex: "#059669",
    inkRgb: [18, 21, 18],
    stoneRgb: [94, 100, 94],
    signalRgb: [5, 150, 105],
  },
  {
    id: "elysium",
    label: "Dark (Elysium)",
    shortLabel: "Dark",
    isDark: true,
    canvasHex: "#07090F",
    surfaceHex: "#0E131D",
    inkHex: "#F5F8FF",
    stoneHex: "#8E9BB0",
    lineHex: "#1C2536",
    signalHex: "#4CE6C0",
    forestHex: "#34D399",
    inkRgb: [245, 248, 255],
    stoneRgb: [142, 155, 176],
    signalRgb: [76, 230, 192],
  },
];

export const THEME_STORAGE_KEY = "canon.theme.v2";
export const DARK_THEME: ThemeId = "elysium";
export const LIGHT_THEME: ThemeId = "alabaster";
const DEFAULT_THEME: ThemeId = "elysium";

function isValidTheme(v: unknown): v is ThemeId {
  return v === "elysium" || v === "alabaster";
}

export function getThemePalette(id: ThemeId): ThemeMeta {
  return THEMES.find((t) => t.id === id) ?? THEMES.find((t) => t.id === "elysium") ?? THEMES[0];
}

let currentTheme: ThemeId = DEFAULT_THEME;
const listeners = new Set<() => void>();

function applyDomTheme(theme: ThemeId) {
  if (typeof document === "undefined") return;
  const meta = getThemePalette(theme);
  document.documentElement.dataset.theme = theme;
  document.documentElement.style.colorScheme = meta.isDark ? "dark" : "light";
  const themeMetaTag = document.querySelector('meta[name="theme-color"]');
  if (themeMetaTag) {
    themeMetaTag.setAttribute("content", meta.canvasHex);
  }
}

if (typeof window !== "undefined") {
  try {
    const saved = window.localStorage.getItem(THEME_STORAGE_KEY);
    if (!saved || saved === "obsidian") {
      currentTheme = "elysium";
      window.localStorage.setItem(THEME_STORAGE_KEY, "elysium");
    } else if (isValidTheme(saved)) {
      currentTheme = saved;
    } else if (isValidTheme(document.documentElement.dataset.theme)) {
      currentTheme = document.documentElement.dataset.theme;
    }
  } catch {
    // Storage unavailable
  }
  applyDomTheme(currentTheme);
}

export function setTheme(next: ThemeId) {
  if (!isValidTheme(next) || next === currentTheme) return;
  currentTheme = next;
  applyDomTheme(next);
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, next);
  } catch {
    // Storage unavailable
  }
  listeners.forEach((fn) => fn());
}

export function toggleColorMode() {
  const next = currentTheme === "elysium" ? "alabaster" : "elysium";
  setTheme(next);
}

export function isDarkMode(theme: ThemeId = currentTheme): boolean {
  return getThemePalette(theme).isDark;
}

export function useTheme(): ThemeId {
  return useSyncExternalStore(
    (onStoreChange) => {
      listeners.add(onStoreChange);
      return () => {
        listeners.delete(onStoreChange);
      };
    },
    () => currentTheme,
    () => DEFAULT_THEME,
  );
}
