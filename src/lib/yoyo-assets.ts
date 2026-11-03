import { useSyncExternalStore } from "react";

export type YoyoNetworkTier = "saver" | "standard" | "retina";

interface NavigatorConnectionLike {
  saveData?: boolean;
  effectiveType?: string;
  type?: string;
  downlink?: number;
  addEventListener?: (type: string, listener: () => void) => void;
  removeEventListener?: (type: string, listener: () => void) => void;
}

export interface YoyoAssetProfile {
  tier: YoyoNetworkTier;
  isCellularSaver: boolean;
  dpr: number;
  mobileAvifSrcSet: string;
  mobileWebpSrcSet: string;
  mobileJpgSrcSet: string;
  desktopAvifSrcSet: string;
  desktopWebpSrcSet: string;
  desktopJpgSrcSet: string;
  fallbackSrc: string;
  sizes: string;
  capsuleAvifSrcSet: string;
  capsuleWebpSrcSet: string;
  capsuleJpgSrc: string;
}

function getConnection(): NavigatorConnectionLike | undefined {
  if (typeof navigator === "undefined") return undefined;
  const nav = navigator as Navigator & {
    connection?: NavigatorConnectionLike;
    mozConnection?: NavigatorConnectionLike;
    webkitConnection?: NavigatorConnectionLike;
  };
  return nav.connection ?? nav.mozConnection ?? nav.webkitConnection;
}

export function detectCellularSaver(): boolean {
  const conn = getConnection();
  if (!conn) return false;
  if (conn.saveData === true) return true;

  const eff = (conn.effectiveType ?? "").toLowerCase();
  if (eff === "slow-2g" || eff === "2g" || eff === "3g") {
    return true;
  }

  const netType = (conn.type ?? "").toLowerCase();
  const downlink = typeof conn.downlink === "number" ? conn.downlink : 10;
  if (netType === "cellular" && downlink > 0 && downlink < 2.8) {
    return true;
  }

  if (downlink > 0 && downlink < 1.4) {
    return true;
  }

  return false;
}

function computeProfile(): YoyoAssetProfile {
  const isCellularSaver = detectCellularSaver();
  const dpr =
    typeof window !== "undefined" && Number.isFinite(window.devicePixelRatio)
      ? Math.min(3, Math.max(1, window.devicePixelRatio))
      : 1;

  const tier: YoyoNetworkTier = isCellularSaver
    ? "saver"
    : dpr >= 1.75
      ? "retina"
      : "standard";

  if (typeof document !== "undefined") {
    document.documentElement.dataset.netTier = isCellularSaver ? "saver" : "full";
  }

  if (isCellularSaver) {
    return {
      tier,
      isCellularSaver: true,
      dpr,
      mobileAvifSrcSet: "/yoyo/mobile-360w.avif 360w",
      mobileWebpSrcSet: "/yoyo/mobile-360w.webp 360w",
      mobileJpgSrcSet: "/yoyo/mobile-360w.jpg 360w",
      desktopAvifSrcSet: "/yoyo/desktop-640w.avif 640w",
      desktopWebpSrcSet: "/yoyo/desktop-640w.webp 640w",
      desktopJpgSrcSet: "/yoyo/desktop-640w.jpg 640w",
      fallbackSrc: "/yoyo/mobile-360w.jpg",
      sizes: "(max-width: 767px) 360px, 640px",
      capsuleAvifSrcSet: "/yoyo/capsule-220w.avif 1x",
      capsuleWebpSrcSet: "/yoyo/capsule-220w.webp 1x",
      capsuleJpgSrc: "/yoyo/capsule-220w.jpg",
    };
  }

  return {
    tier,
    isCellularSaver: false,
    dpr,
    mobileAvifSrcSet:
      "/yoyo/mobile-360w.avif 360w, /yoyo/mobile-540w.avif 540w, /yoyo/mobile-768w.avif 768w, /yoyo/mobile-1152w.avif 1152w",
    mobileWebpSrcSet:
      "/yoyo/mobile-360w.webp 360w, /yoyo/mobile-540w.webp 540w, /yoyo/mobile-768w.webp 768w, /yoyo/mobile-1152w.webp 1152w",
    mobileJpgSrcSet:
      "/yoyo/mobile-360w.jpg 360w, /yoyo/mobile-540w.jpg 540w, /yoyo/mobile-768w.jpg 768w, /yoyo/mobile-1152w.jpg 1152w",
    desktopAvifSrcSet:
      "/yoyo/desktop-640w.avif 640w, /yoyo/desktop-1024w.avif 1024w, /yoyo/desktop-1376w.avif 1376w, /yoyo/desktop-2064w.avif 2064w",
    desktopWebpSrcSet:
      "/yoyo/desktop-640w.webp 640w, /yoyo/desktop-1024w.webp 1024w, /yoyo/desktop-1376w.webp 1376w, /yoyo/desktop-2064w.webp 2064w",
    desktopJpgSrcSet:
      "/yoyo/desktop-640w.jpg 640w, /yoyo/desktop-1024w.jpg 1024w, /yoyo/desktop-1376w.jpg 1376w, /yoyo/desktop-2064w.jpg 2064w",
    fallbackSrc: "/yoyo/mobile-768w.jpg",
    sizes: "100vw",
    capsuleAvifSrcSet:
      "/yoyo/capsule-220w.avif 1x, /yoyo/capsule-440w.avif 2x, /yoyo/capsule-660w.avif 3x",
    capsuleWebpSrcSet:
      "/yoyo/capsule-220w.webp 1x, /yoyo/capsule-440w.webp 2x, /yoyo/capsule-660w.webp 3x",
    capsuleJpgSrc: "/yoyo/capsule-440w.jpg",
  };
}

let cachedProfile: YoyoAssetProfile = computeProfile();

function refreshProfile(notify: () => void) {
  const next = computeProfile();
  if (
    next.tier !== cachedProfile.tier ||
    next.dpr !== cachedProfile.dpr ||
    next.isCellularSaver !== cachedProfile.isCellularSaver
  ) {
    cachedProfile = next;
    notify();
  }
}

function subscribe(onStoreChange: () => void): () => void {
  if (typeof window === "undefined") return () => {};

  const conn = getConnection();
  const handleUpdate = () => refreshProfile(onStoreChange);

  conn?.addEventListener?.("change", handleUpdate);
  window.addEventListener("resize", handleUpdate, { passive: true });

  return () => {
    conn?.removeEventListener?.("change", handleUpdate);
    window.removeEventListener("resize", handleUpdate);
  };
}

function getSnapshot(): YoyoAssetProfile {
  return cachedProfile;
}

export function useYoyoAssetProfile(): YoyoAssetProfile {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
