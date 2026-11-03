import { useSyncExternalStore } from "react";
import { detectCellularSaver } from "./yoyo-assets";

export type GraphicsTier = "full" | "balanced" | "lite";

interface NavigatorHardwareHints {
  hardwareConcurrency?: number;
  deviceMemory?: number;
}

function supportsBackdropBlur(): boolean {
  if (typeof window === "undefined" || typeof CSS === "undefined" || typeof CSS.supports !== "function") {
    return true;
  }
  return (
    CSS.supports("backdrop-filter", "blur(2px)") ||
    CSS.supports("-webkit-backdrop-filter", "blur(2px)")
  );
}

export function detectInitialGraphicsTier(): GraphicsTier {
  if (typeof window === "undefined") return "full";

  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return "lite";
  }

  if (!supportsBackdropBlur()) {
    return "lite";
  }

  const nav = navigator as Navigator & NavigatorHardwareHints;
  const cores = typeof nav.hardwareConcurrency === "number" ? nav.hardwareConcurrency : 8;
  const memory = typeof nav.deviceMemory === "number" ? nav.deviceMemory : 8;

  // Mobile browsers privacy-cap deviceMemory (often to 2 or 4). Only step to balanced on very small hardware or data-saver.
  if (
    (cores > 0 && cores <= 2) ||
    (memory > 0 && memory <= 1) ||
    detectCellularSaver()
  ) {
    return "balanced";
  }

  return "full";
}

let currentTier: GraphicsTier = detectInitialGraphicsTier();
const listeners = new Set<() => void>();

function syncDomAttribute(tier: GraphicsTier) {
  if (typeof document !== "undefined") {
    document.documentElement.dataset.gfxTier = tier;
  }
}

syncDomAttribute(currentTier);

function setGraphicsTier(next: GraphicsTier) {
  if (currentTier === next) return;
  currentTier = next;
  syncDomAttribute(next);
  listeners.forEach((fn) => fn());
}

// Rolling live frame-time guard: waits past initial React mount & network hydration before sampling
const moduleBootMs = typeof performance !== "undefined" ? performance.now() : 0;
let warmupFramesRemaining = 45;
let sampleCount = 0;
let accumulatedMs = 0;
let cooldownUntil = moduleBootMs + 1800;

export function resetFrameBudgetWindow() {
  warmupFramesRemaining = 45;
  sampleCount = 0;
  accumulatedMs = 0;
  if (typeof performance !== "undefined") {
    cooldownUntil = Math.max(cooldownUntil, performance.now() + 900);
  }
}

export function recordFrameBudget(deltaMs: number, nowMs: number) {
  if (currentTier === "lite") return;
  if (typeof document !== "undefined" && document.hidden) {
    resetFrameBudgetWindow();
    return;
  }
  // Ignore invalid deltas or one-off main-thread mount/GC hiccups (> 160ms)
  if (!Number.isFinite(deltaMs) || deltaMs <= 0 || deltaMs > 160) {
    return;
  }

  if (nowMs < cooldownUntil) {
    return;
  }

  if (warmupFramesRemaining > 0) {
    warmupFramesRemaining -= 1;
    return;
  }

  sampleCount += 1;
  accumulatedMs += deltaMs;

  if (sampleCount >= 24) {
    const avgMs = accumulatedMs / sampleCount;
    sampleCount = 0;
    accumulatedMs = 0;

    if (currentTier === "full" && avgMs > 38) {
      cooldownUntil = nowMs + 1400;
      setGraphicsTier("balanced");
    } else if (currentTier === "balanced" && avgMs > 46) {
      cooldownUntil = nowMs + 1400;
      setGraphicsTier("lite");
    }
  }
}

export function getGraphicsTier(): GraphicsTier {
  return currentTier;
}

function subscribe(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);

  let mql: MediaQueryList | null = null;
  const onMotionPrefChange = () => {
    if (mql?.matches) {
      setGraphicsTier("lite");
    } else {
      setGraphicsTier(detectInitialGraphicsTier());
    }
  };

  if (typeof window !== "undefined") {
    mql = window.matchMedia("(prefers-reduced-motion: reduce)");
    mql.addEventListener?.("change", onMotionPrefChange);
  }

  return () => {
    listeners.delete(onStoreChange);
    mql?.removeEventListener?.("change", onMotionPrefChange);
  };
}

export function useGraphicsTier(): GraphicsTier {
  return useSyncExternalStore(subscribe, getGraphicsTier, getGraphicsTier);
}
