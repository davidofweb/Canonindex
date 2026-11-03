import { useCallback, useEffect, useRef, useSyncExternalStore } from "react";
import { getGraphicsTier } from "./device-quality";

export type DeviceTiltStatus =
  | "idle"
  | "promptable"
  | "active"
  | "denied"
  | "unsupported";

export interface DeviceTiltSample {
  /** Normalized horizontal phone roll in [-1, 1] */
  nx: number;
  /** Normalized vertical phone pitch in [-1, 1] */
  ny: number;
  /** Physical 3D X-axis pitch rotation in degrees */
  rotateX: number;
  /** Physical 3D Y-axis roll rotation in degrees */
  rotateY: number;
  /** Physical Z-axis planar capsule rotation in degrees */
  rotateZ: number;
  /** Normalized specular highlight offset [-1, 1] */
  glareX: number;
  /** Normalized specular highlight offset [-1, 1] */
  glareY: number;
  /** True once real numeric gyroscope/orientation readings arrive */
  active: boolean;
  /** Timestamp (performance.now) of latest orientation reading */
  updatedAt: number;
}

export interface UseDeviceTiltOptions {
  /** Maximum 3D X-axis pitch rotation in degrees (default: 9.5) */
  maxRotateX?: number;
  /** Maximum 3D Y-axis yaw/roll rotation in degrees (default: 12) */
  maxRotateY?: number;
  /** Maximum Z-axis planar rotation in degrees (default: 4.5) */
  maxRotateZ?: number;
  /** Tilt angle in degrees that maps to ~76% of full deflection (default: 22) */
  sensitivityDeg?: number;
  /** Disable listener when false (default: true) */
  enabled?: boolean;
}

interface DeviceOrientationConstructorWithPermission {
  requestPermission?: () => Promise<"granted" | "denied" | "default">;
}

const ZERO_SAMPLE: DeviceTiltSample = {
  nx: 0,
  ny: 0,
  rotateX: 0,
  rotateY: 0,
  rotateZ: 0,
  glareX: 0,
  glareY: 0,
  active: false,
  updatedAt: 0,
};

// Shared singleton sensor state across all mounted Liquid Glass surfaces
let globalStatus: DeviceTiltStatus = detectInitialStatus();
let subscriberCount = 0;
let listening = false;
let autoUnlockBound = false;

let hasBaseline = false;
let baseRollDeg = 0;
let basePitchDeg = 0;
let smoothNx = 0;
let smoothNy = 0;
let hasReceivedEvent = false;
let lastUpdatedAt = 0;

const statusListeners = new Set<() => void>();

function notifyStatus() {
  statusListeners.forEach((fn) => fn());
}

function setGlobalStatus(next: DeviceTiltStatus) {
  if (globalStatus !== next) {
    globalStatus = next;
    notifyStatus();
  }
}

function prefersReducedMotion(): boolean {
  return (
    typeof window !== "undefined" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches
  );
}

function getPermissionFn():
  | (() => Promise<"granted" | "denied" | "default">)
  | undefined {
  if (typeof window === "undefined" || typeof DeviceOrientationEvent === "undefined") {
    return undefined;
  }
  const ctor =
    DeviceOrientationEvent as unknown as DeviceOrientationConstructorWithPermission;
  return typeof ctor.requestPermission === "function"
    ? ctor.requestPermission.bind(DeviceOrientationEvent)
    : undefined;
}

function detectInitialStatus(): DeviceTiltStatus {
  if (typeof window === "undefined") return "idle";
  if (prefersReducedMotion()) return "unsupported";
  if (typeof DeviceOrientationEvent === "undefined") return "unsupported";
  if (getPermissionFn()) return "promptable";
  return "idle";
}

function getScreenAngle(): number {
  if (typeof window === "undefined") return 0;
  const angle = window.screen?.orientation?.angle;
  if (typeof angle === "number" && Number.isFinite(angle)) {
    return ((angle % 360) + 360) % 360;
  }
  return 0;
}

/**
 * Remaps raw DeviceOrientation beta [-180..180] and gamma [-90..90]
 * into screen-relative roll (left/right) and pitch (top/bottom) degrees.
 */
function readScreenAlignedAngles(
  beta: number,
  gamma: number
): { roll: number; pitch: number } {
  const clampedBeta = Math.max(-135, Math.min(135, beta));
  const clampedGamma = Math.max(-89, Math.min(89, gamma));
  const angle = getScreenAngle();

  if (angle === 90) {
    return { roll: clampedBeta, pitch: -clampedGamma };
  }
  if (angle === 270) {
    return { roll: -clampedBeta, pitch: clampedGamma };
  }
  if (angle === 180) {
    return { roll: -clampedGamma, pitch: -clampedBeta };
  }
  return { roll: clampedGamma, pitch: clampedBeta };
}

function handleDeviceOrientation(e: DeviceOrientationEvent) {
  if (prefersReducedMotion()) return;
  if (typeof e.beta !== "number" || typeof e.gamma !== "number") return;
  if (!Number.isFinite(e.beta) || !Number.isFinite(e.gamma)) return;

  const { roll, pitch } = readScreenAlignedAngles(e.beta, e.gamma);

  if (!hasBaseline) {
    baseRollDeg = roll;
    basePitchDeg = pitch;
    hasBaseline = true;
  } else {
    // Gentle drift adaptation so natural changes in grip posture slowly re-center
    baseRollDeg += (roll - baseRollDeg) * 0.007;
    basePitchDeg += (pitch - basePitchDeg) * 0.007;
  }

  const deltaRoll = roll - baseRollDeg;
  const deltaPitch = pitch - basePitchDeg;

  // Low-pass filter in normalized angle space (1 degree base unit, scaled per consumer)
  smoothNx += (deltaRoll - smoothNx) * 0.28;
  smoothNy += (deltaPitch - smoothNy) * 0.28;
  hasReceivedEvent = true;
  lastUpdatedAt = performance.now();

  if (globalStatus !== "active") {
    setGlobalStatus("active");
  }
}

function handleOrientationChange() {
  hasBaseline = false;
}

function handleVisibilityChange() {
  if (typeof document !== "undefined" && !document.hidden) {
    hasBaseline = false;
  }
}

function startGlobalListener() {
  if (listening || typeof window === "undefined") return;
  if (
    prefersReducedMotion() ||
    getGraphicsTier() === "lite" ||
    typeof DeviceOrientationEvent === "undefined"
  ) {
    setGlobalStatus("unsupported");
    return;
  }
  listening = true;
  window.addEventListener("deviceorientation", handleDeviceOrientation, {
    passive: true,
  });
  window.addEventListener("orientationchange", handleOrientationChange, {
    passive: true,
  });
  document.addEventListener("visibilitychange", handleVisibilityChange);
}

function stopGlobalListener() {
  if (!listening || typeof window === "undefined") return;
  listening = false;
  window.removeEventListener("deviceorientation", handleDeviceOrientation);
  window.removeEventListener("orientationchange", handleOrientationChange);
  document.removeEventListener("visibilitychange", handleVisibilityChange);
}

/**
 * Re-calibrates the neutral phone holding posture to the user's current grip angle.
 */
export function recenterDeviceTilt() {
  hasBaseline = false;
}

/**
 * Unlocks DeviceOrientationEvent on iOS 13+ Safari when invoked inside a user tap/click gesture.
 * Returns true if orientation listening is active or permitted.
 */
export async function requestDeviceTiltAccess(): Promise<boolean> {
  if (typeof window === "undefined") return false;
  if (prefersReducedMotion() || typeof DeviceOrientationEvent === "undefined") {
    setGlobalStatus("unsupported");
    return false;
  }

  const requestFn = getPermissionFn();
  if (!requestFn) {
    recenterDeviceTilt();
    startGlobalListener();
    return true;
  }

  if (globalStatus === "active") {
    recenterDeviceTilt();
    return true;
  }

  try {
    const result = await requestFn();
    if (result === "granted") {
      recenterDeviceTilt();
      startGlobalListener();
      setGlobalStatus("active");
      return true;
    }
    setGlobalStatus("denied");
    return false;
  } catch {
    return false;
  }
}

function bindFirstGestureAutoUnlock() {
  if (autoUnlockBound || typeof document === "undefined") return;
  if (!getPermissionFn() || globalStatus !== "promptable") return;

  autoUnlockBound = true;
  const onFirstTap = () => {
    document.removeEventListener("click", onFirstTap);
    autoUnlockBound = false;
    if (globalStatus === "promptable") {
      void requestDeviceTiltAccess();
    }
  };
  document.addEventListener("click", onFirstTap, { once: true });
}

function subscribeStatus(onStoreChange: () => void): () => void {
  statusListeners.add(onStoreChange);
  return () => {
    statusListeners.delete(onStoreChange);
  };
}

function getStatusSnapshot(): DeviceTiltStatus {
  return globalStatus;
}

/**
 * Zero-rerender 60fps phone tilt hook for Liquid Glass physical capsule rotation & refraction.
 * Reads DeviceOrientationEvent, auto-calibrates to the user's natural holding angle,
 * handles screen rotation, and unlocks iOS Safari motion access on tap.
 */
export function useDeviceTilt(options: UseDeviceTiltOptions = {}) {
  const {
    maxRotateX = 9.5,
    maxRotateY = 12,
    maxRotateZ = 4.5,
    sensitivityDeg = 22,
    enabled = true,
  } = options;

  const status = useSyncExternalStore(
    subscribeStatus,
    getStatusSnapshot,
    getStatusSnapshot
  );

  const sampleRef = useRef<DeviceTiltSample>({ ...ZERO_SAMPLE });

  useEffect(() => {
    if (!enabled || prefersReducedMotion()) {
      sampleRef.current = { ...ZERO_SAMPLE };
      return;
    }

    subscriberCount += 1;

    if (!getPermissionFn()) {
      startGlobalListener();
    } else if (globalStatus === "promptable") {
      bindFirstGestureAutoUnlock();
    } else if (globalStatus === "active") {
      startGlobalListener();
    }

    let rafId = 0;
    const scale = Math.max(6, sensitivityDeg);

    const syncSample = () => {
      if (
        (typeof document !== "undefined" && document.hidden) ||
        getGraphicsTier() === "lite"
      ) {
        sampleRef.current.active = false;
        rafId = window.requestAnimationFrame(syncSample);
        return;
      }

      if (!hasReceivedEvent) {
        sampleRef.current.active = false;
      } else {
        // Smooth asymptotic curve so small tilts feel crisp and wide tilts never hard-clip
        const nx = Math.tanh(smoothNx / scale);
        const ny = Math.tanh(smoothNy / scale);

        const s = sampleRef.current;
        s.nx = nx;
        s.ny = ny;
        s.rotateX = -ny * maxRotateX;
        s.rotateY = nx * maxRotateY;
        s.rotateZ = nx * maxRotateZ;
        s.glareX = -nx;
        s.glareY = -ny;
        s.active = true;
        s.updatedAt = lastUpdatedAt;
      }
      rafId = window.requestAnimationFrame(syncSample);
    };

    rafId = window.requestAnimationFrame(syncSample);

    return () => {
      window.cancelAnimationFrame(rafId);
      subscriberCount = Math.max(0, subscriberCount - 1);
      if (subscriberCount === 0) {
        stopGlobalListener();
      }
    };
  }, [enabled, maxRotateX, maxRotateY, maxRotateZ, sensitivityDeg]);

  const unlockTilt = useCallback(() => {
    return requestDeviceTiltAccess();
  }, []);

  const recenter = useCallback(() => {
    recenterDeviceTilt();
  }, []);

  return {
    tiltRef: sampleRef,
    status,
    needsPermission: status === "promptable",
    unlockTilt,
    recenter,
  };
}
