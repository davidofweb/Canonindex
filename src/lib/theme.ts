import { useSyncExternalStore } from "react";

export type ThemeId = "elysium" | "cobalt" | "alabaster" | "titanium";

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
    id: "elysium",
    label: "Elysium & Mint",
    shortLabel: "Elysium",
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
  {
    id: "cobalt",
    label: "Glacier & Cobalt",
    shortLabel: "Cobalt",
    isDark: false,
    canvasHex: "#F2F5FB",
    surfaceHex: "#FFFFFF",
    inkHex: "#0B1120",
    stoneHex: "#526077",
    lineHex: "#DCE3EE",
    signalHex: "#2563EB",
    forestHex: "#059669",
    inkRgb: [11, 17, 32],
    stoneRgb: [82, 96, 119],
    signalRgb: [37, 99, 235],
  },
  {
    id: "alabaster",
    label: "Alabaster & Emerald",
    shortLabel: "Alabaster",
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
    id: "titanium",
    label: "Titanium & Lime",
    shortLabel: "Titanium",
    isDark: true,
    canvasHex: "#101216",
    surfaceHex: "#171A21",
    inkHex: "#F2F3F5",
    stoneHex: "#8E939E",
    lineHex: "#262B35",
    signalHex: "#B8FF2C",
    forestHex: "#4ADE80",
    inkRgb: [242, 243, 245],
    stoneRgb: [142, 147, 158],
    signalRgb: [184, 255, 44],
  },
];

export const THEME_STORAGE_KEY = "canon.theme.v1";
const DEFAULT_THEME: ThemeId = "elysium";

function isValidTheme(v: unknown): v is ThemeId {
  return v === "elysium" || v === "cobalt" || v === "alabaster" || v === "titanium";
}

export function getThemePalette(id: ThemeId): ThemeMeta {
  return THEMES.find((t) => t.id === id) ?? THEMES[0];
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
    if (saved === "obsidian") {
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
