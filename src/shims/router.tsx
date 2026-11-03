import { useSyncExternalStore } from "react";

type Listener = () => void;
const listeners = new Set<Listener>();

function emit() {
  for (const fn of listeners) fn();
}

if (typeof window !== "undefined") {
  window.addEventListener("popstate", emit);
  window.addEventListener("hashchange", emit);
}

function subscribe(cb: Listener) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

function getLocationKey() {
  if (typeof window === "undefined") return "/";
  return `${window.location.pathname}${window.location.search}${window.location.hash}`;
}

export function useLocationState() {
  const key = useSyncExternalStore(subscribe, getLocationKey, () => "/");
  const qIdx = key.indexOf("?");
  const hIdx = key.indexOf("#");
  const endPath = qIdx >= 0 ? qIdx : hIdx >= 0 ? hIdx : key.length;
  const pathname = key.slice(0, endPath) || "/";
  const search = qIdx >= 0 ? key.slice(qIdx, hIdx >= 0 ? hIdx : key.length) : "";
  const hash = hIdx >= 0 ? key.slice(hIdx) : "";
  return { pathname, search, hash };
}

export function scrollToHash(hash: string) {
  if (!hash || typeof document === "undefined") return false;
  const id = decodeURIComponent(hash.replace(/^#/, ""));
  if (!id) return false;
  const el = document.getElementById(id);
  if (el) {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
    return true;
  }
  return false;
}

export function clearCanonQueryParam() {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (!url.searchParams.has("canon")) return;
  url.searchParams.delete("canon");
  const nextSearch = url.searchParams.toString();
  window.history.replaceState(
    null,
    "",
    `${url.pathname}${nextSearch ? `?${nextSearch}` : ""}${url.hash}`,
  );
  emit();
}

export function navigate(href: string) {
  if (typeof window === "undefined") return;
  if (href.startsWith("#")) {
    window.history.pushState(null, "", href);
    emit();
    requestAnimationFrame(() => scrollToHash(href));
    return;
  }
  const url = new URL(href, window.location.origin);
  if (!url.searchParams.has("canon")) {
    const currentParams = new URLSearchParams(window.location.search);
    const activeCanon = currentParams.get("canon");
    if (activeCanon) {
      url.searchParams.set("canon", activeCanon);
    }
  }
  const samePath = url.pathname === window.location.pathname && url.search === window.location.search;
  window.history.pushState(null, "", `${url.pathname}${url.search}${url.hash}`);
  emit();
  if (url.hash) {
    requestAnimationFrame(() => {
      if (!scrollToHash(url.hash)) {
        setTimeout(() => scrollToHash(url.hash), 80);
      }
    });
  } else if (!samePath) {
    window.scrollTo({ top: 0, left: 0, behavior: "instant" as ScrollBehavior });
  }
}

export class NotFoundSignal extends Error {
  constructor() {
    super("NOT_FOUND");
  }
}
