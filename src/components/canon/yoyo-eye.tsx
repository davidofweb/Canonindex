import { useEffect, useMemo, useRef, useState } from "react";
import {
  getGraphicsTier,
  recordFrameBudget,
  resetFrameBudgetWindow,
  useGraphicsTier,
} from "@/lib/device-quality";
import { getThemePalette, useTheme } from "@/lib/theme";
import { useDeviceTilt } from "@/lib/use-device-tilt";
import { useYoyoAssetProfile } from "@/lib/yoyo-assets";
import {
  completeBootSequence,
  dismissAddressVerify,
  setScreenIdle,
  useRegisterInlineVerifyStage,
  useYoyoLoader,
  type VerifyPosture,
} from "@/lib/yoyo-loader";
import { CanonWordmark } from "./code-art";

type CapsuleSize = "hero" | "stage" | "compact";

const SIZE_METRICS: Record<
  CapsuleSize,
  {
    shellClass: string;
    visorClass: string;
    eyeWidth: number;
    eyeHeight: number;
    eyeGap: number;
    maxTravelX: number;
    maxTravelY: number;
  }
> = {
  hero: {
    shellClass: "h-[96px] w-[204px] p-[9px] sm:h-[104px] sm:w-[222px] sm:p-[10px]",
    visorClass: "h-full w-full",
    eyeWidth: 22,
    eyeHeight: 38,
    eyeGap: 28,
    maxTravelX: 21,
    maxTravelY: 10.5,
  },
  stage: {
    shellClass: "h-[74px] w-[158px] p-[7.5px]",
    visorClass: "h-full w-full",
    eyeWidth: 17,
    eyeHeight: 30,
    eyeGap: 22,
    maxTravelX: 16.5,
    maxTravelY: 8,
  },
  compact: {
    shellClass: "h-[44px] w-[88px] p-[4.5px]",
    visorClass: "h-full w-full",
    eyeWidth: 9.5,
    eyeHeight: 17,
    eyeGap: 11,
    maxTravelX: 9,
    maxTravelY: 4.5,
  },
};

const BASE_EYE_CODES = [
  "0x4C",
  "9980",
  "VAULT",
  "0xE6",
  "MINT",
  "BURN",
  "100%",
  "LENS",
] as const;

const GLITCH_GLYPHS = "0123456789ABCDEF#$%&*+/<>[]{}~";

function mutateCodeLine(line: string, intensity: number): string {
  const chars = line.split("");
  const flips = Math.max(1, Math.min(chars.length, intensity));
  for (let i = 0; i < flips; i++) {
    const idx = Math.floor(Math.random() * chars.length);
    chars[idx] = GLITCH_GLYPHS[Math.floor(Math.random() * GLITCH_GLYPHS.length)];
  }
  return chars.join("");
}

function GlitchEyeCodeStream() {
  const [lines, setLines] = useState<string[]>(() => [...BASE_EYE_CODES]);
  const [glitchingIndex, setGlitchingIndex] = useState<number | null>(null);
  const [jitterX, setJitterX] = useState(0);

  useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;

    let cycleTimer: number | null = null;
    const burstTimers: number[] = [];

    const clearBursts = () => {
      while (burstTimers.length > 0) {
        const id = burstTimers.pop();
        if (id !== undefined) window.clearTimeout(id);
      }
    };

    const triggerGlitchBurst = () => {
      clearBursts();
      const targetIdx = Math.floor(Math.random() * BASE_EYE_CODES.length);
      const secondaryIdx = (targetIdx + 3) % BASE_EYE_CODES.length;
      const steps = 4;

      for (let step = 0; step < steps; step++) {
        const t = window.setTimeout(() => {
          setGlitchingIndex(targetIdx);
          setJitterX(step % 2 === 0 ? 0.9 : -0.9);
          setLines(
            BASE_EYE_CODES.map((base, idx) => {
              if (idx === targetIdx) return mutateCodeLine(base, 2);
              if (idx === secondaryIdx) return mutateCodeLine(base, 1);
              return base;
            })
          );
        }, step * 65);
        burstTimers.push(t);
      }

      const settleTimer = window.setTimeout(() => {
        setGlitchingIndex(null);
        setJitterX(0);
        // Leave 1 subtle mutated character on a random line until the next glitch cycle
        const stickyIdx = Math.floor(Math.random() * BASE_EYE_CODES.length);
        setLines(
          BASE_EYE_CODES.map((base, idx) =>
            idx === stickyIdx ? mutateCodeLine(base, 1) : base
          )
        );
      }, steps * 65 + 45);
      burstTimers.push(settleTimer);
    };

    const scheduleNext = () => {
      const delayMs = 1900 + Math.floor(Math.random() * 1100);
      cycleTimer = window.setTimeout(() => {
        triggerGlitchBurst();
        scheduleNext();
      }, delayMs);
    };

    scheduleNext();

    return () => {
      if (cycleTimer !== null) window.clearTimeout(cycleTimer);
      clearBursts();
    };
  }, []);

  const repeated = [...lines, ...lines];

  return (
    <div
      aria-hidden="true"
      className="animate-yoyo-eye-code pointer-events-none absolute inset-x-0 top-0 flex flex-col items-center text-center font-mono text-[5.5px] leading-[7px] font-extrabold tracking-tighter text-[#051018]/85 select-none"
    >
      {repeated.map((code, idx) => {
        const isGlitching =
          glitchingIndex !== null && idx % BASE_EYE_CODES.length === glitchingIndex;
        return (
          <span
            key={idx}
            style={
              isGlitching
                ? {
                    transform: `translate3d(${jitterX}px, 0, 0)`,
                    color: "rgba(255, 255, 255, 0.96)",
                    textShadow: "0 0 4px rgba(255, 255, 255, 0.85)",
                  }
                : undefined
            }
          >
            {code}
          </span>
        );
      })}
    </div>
  );
}

/**
 * MagicOS-inspired Liquid Glass YOYO Twin-Eye Capsule.
 * Tracks touch drag, pointer cursor, or subtle phone tilt with spring-damped inertia,
 * natural blinking, yoyo elastic tap bounce, and live 0x scan choreography.
 */
export function YoyoLiquidCapsule({
  size = "hero",
  posture = "idle",
  onTap,
  ariaLabel = "CANON YOYO optical status",
  withRearRefraction = false,
  codeInsideEyes = false,
}: {
  size?: CapsuleSize;
  posture?: VerifyPosture;
  onTap?: () => void;
  ariaLabel?: string;
  /** Enables the counter-shifting glass halo & refracted light ring on the full-screen boot stage */
  withRearRefraction?: boolean;
  /** Streams live hex & contract codes inside the glowing YOYO eyes */
  codeInsideEyes?: boolean;
}) {
  const theme = useTheme();
  const palette = getThemePalette(theme);
  const spec = SIZE_METRICS[size];
  const assetProfile = useYoyoAssetProfile();
  const gfxTier = useGraphicsTier();
  const [lensFailed, setLensFailed] = useState(false);
  const [rippleKey, setRippleKey] = useState(0);

  const isLite = gfxTier === "lite";
  const showRearLayer = withRearRefraction && size === "hero";

  const tiltScale = size === "hero" ? 1 : size === "stage" ? 0.78 : 0.45;
  const { tiltRef, needsPermission, unlockTilt } = useDeviceTilt({
    maxRotateX: 9.5 * tiltScale,
    maxRotateY: 12.5 * tiltScale,
    maxRotateZ: 4.8 * tiltScale,
    sensitivityDeg: 21,
    enabled: !isLite,
  });

  const shellRef = useRef<HTMLButtonElement | null>(null);
  const rearHaloRef = useRef<HTMLDivElement | null>(null);
  const rearRingRef = useRef<HTMLDivElement | null>(null);
  const causticRef = useRef<HTMLDivElement | null>(null);
  const meniscusRef = useRef<HTMLDivElement | null>(null);
  const domeSheenRef = useRef<HTMLDivElement | null>(null);
  const visorGlossRef = useRef<HTMLDivElement | null>(null);
  const eyePairRef = useRef<HTMLDivElement | null>(null);
  const leftEyeRef = useRef<HTMLDivElement | null>(null);
  const rightEyeRef = useRef<HTMLDivElement | null>(null);
  const leftCatchRef = useRef<HTMLSpanElement | null>(null);
  const rightCatchRef = useRef<HTMLSpanElement | null>(null);

  const postureRef = useRef<VerifyPosture>(posture);
  postureRef.current = posture;

  const tapImpulseRef = useRef<() => void>(() => {});

  useEffect(() => {
    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;

    if (withRearRefraction) {
      resetFrameBudgetWindow();
    }

    let rafId = 0;
    const startTs = performance.now();
    let prevTs = startTs;

    // Normalized gaze target [-1..1]
    let targetX = 0;
    let targetY = 0;
    let lastPointerAt = 0;

    // Spring-integrated gaze position & velocity
    let gx = 0;
    let gy = 0;
    let vx = 0;
    let vy = 0;

    // Yoyo vertical elastic bounce & squash state
    let yoyoY = -14; // Initial wake drop-in
    let yoyoVy = 0;
    let squash = -0.18;
    let squashV = 0;

    // Wake eyelid opening (starts as thin horizontal slit -> 1)
    let wakeOpen = 0.08;

    // Autonomous natural blink scheduler
    let nextBlinkAt = startTs + 680;
    let blinkStart = -1;
    let blinkDuration = 165;
    let pendingDoubleBlink = false;

    // Autonomous idle micro-glances when user isn't touching/moving
    let nextGlanceAt = startTs + 1500;
    let idleTargetX = 0;
    let idleTargetY = 0;

    const updateFromClientXY = (clientX: number, clientY: number) => {
      const vw = Math.max(1, window.innerWidth);
      const vh = Math.max(1, window.innerHeight);
      const rect = shellRef.current?.getBoundingClientRect();
      const cx = rect ? rect.left + rect.width / 2 : vw / 2;
      const cy = rect ? rect.top + rect.height / 2 : vh * 0.44;

      const nx = Math.max(-1, Math.min(1, (clientX - cx) / (vw * 0.36)));
      const ny = Math.max(-1, Math.min(1, (clientY - cy) / (vh * 0.34)));
      targetX = nx;
      targetY = ny;
      lastPointerAt = performance.now();
    };

    const onPointerMove = (e: PointerEvent) => {
      updateFromClientXY(e.clientX, e.clientY);
    };

    const onTouchMove = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t) updateFromClientXY(t.clientX, t.clientY);
    };

    const onTouchStart = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t) updateFromClientXY(t.clientX, t.clientY);
    };

    // Spring-integrated 3D physical capsule rotation state (driven by phone tilt + subtle pointer)
    let rotX = 0;
    let rotY = 0;
    let rotZ = 0;
    let vRotX = 0;
    let vRotY = 0;
    let vRotZ = 0;

    // Counter-shifting rear refraction halo & light ring state (trails opposite to tilt)
    let haloX = 0;
    let haloY = 10; // Subtle opposite wake rise
    let haloVx = 0;
    let haloVy = 0;
    let haloPulse = 0;
    let haloPulseV = 0;

    tapImpulseRef.current = () => {
      yoyoVy = 13.5;
      squash = -0.26;
      haloVy = -9.5;
      haloPulseV = 0.24;
      blinkStart = performance.now();
      blinkDuration = 150;
    };

    window.addEventListener("pointermove", onPointerMove, { passive: true });
    window.addEventListener("touchmove", onTouchMove, { passive: true });
    window.addEventListener("touchstart", onTouchStart, { passive: true });

    const frame = (now: number) => {
      if (typeof document !== "undefined" && document.hidden) {
        prevTs = now;
        rafId = window.requestAnimationFrame(frame);
        return;
      }

      const rawDeltaMs = now - prevTs;
      prevTs = now;
      if (withRearRefraction) {
        recordFrameBudget(rawDeltaMs, now);
      }

      const dt = Math.min(2.2, Math.max(0.5, rawDeltaMs / 16.667));
      const elapsedSec = (now - startTs) / 1000;
      const mode = postureRef.current;
      const tierNow = getGraphicsTier();
      const liteNow = tierNow === "lite";
      const tilt = tiltRef.current;
      const pointerFresh = now - lastPointerAt < 1650;

      // Smooth wake opening over first ~360ms
      wakeOpen += (1 - wakeOpen) * (0.16 * dt);

      // Gentle ambient liquid shimmer when device is resting still so glass refraction always feels alive
      const ambientWaveX = Math.sin(elapsedSec * 1.45) * 0.28;
      const ambientWaveY = Math.cos(elapsedSec * 1.15) * 0.22;

      // Determine active gaze target by posture
      let desiredX = targetX;
      let desiredY = targetY;
      let leftScaleY = 1;
      let rightScaleY = 1;
      let capsuleTilt = 0;

      if (mode === "scan") {
        // Rhythmic horizontal 0x hex character scan sweep
        const sweep = Math.sin(elapsedSec * 5.6);
        const pointerBias = now - lastPointerAt < 1200 ? targetX * 0.25 : 0;
        desiredX = Math.max(-1, Math.min(1, sweep * 0.86 + pointerBias));
        desiredY = Math.sin(elapsedSec * 11.2) * 0.08;
        leftScaleY = 0.8;
        rightScaleY = 0.8;
      } else if (mode === "sign") {
        // Attentive upward focus while waiting on wallet signature
        desiredX = now - lastPointerAt < 1200 ? targetX * 0.45 : Math.sin(elapsedSec * 1.8) * 0.16;
        desiredY = -0.56;
        const pulse = 0.94 + Math.sin(elapsedSec * 4.2) * 0.06;
        leftScaleY = pulse;
        rightScaleY = pulse;
      } else if (mode === "confirm") {
        desiredX = 0;
        desiredY = -0.14;
        leftScaleY = 0.92;
        rightScaleY = 0.92;
      } else if (mode === "alert") {
        desiredX = now - lastPointerAt < 1400 ? targetX * 0.5 : 0.18;
        desiredY = 0;
        leftScaleY = 1.06;
        rightScaleY = 0.7;
        capsuleTilt = -4.5;
      } else {
        // Idle / boot mode: follow finger or cursor, then phone tilt, otherwise perform gentle glances
        if (!pointerFresh) {
          if (tilt.active && (Math.abs(tilt.nx) > 0.035 || Math.abs(tilt.ny) > 0.035)) {
            desiredX = Math.max(-1, Math.min(1, tilt.nx * 0.92));
            desiredY = Math.max(-1, Math.min(1, tilt.ny * 0.88));
          } else {
            if (now >= nextGlanceAt) {
              const r = Math.random();
              if (r < 0.34) {
                idleTargetX = -0.52 + Math.random() * 0.22;
                idleTargetY = (Math.random() - 0.5) * 0.28;
              } else if (r < 0.68) {
                idleTargetX = 0.3 + Math.random() * 0.26;
                idleTargetY = (Math.random() - 0.5) * 0.28;
              } else {
                idleTargetX = 0;
                idleTargetY = 0;
              }
              nextGlanceAt = now + 1350 + Math.random() * 1400;
            }
            desiredX = idleTargetX + (tilt.active ? tilt.nx * 0.35 : 0);
            desiredY = idleTargetY + (tilt.active ? tilt.ny * 0.35 : 0);
          }
        }
      }

      // Spring physics for gaze
      const ax = (desiredX - gx) * 0.17;
      const ay = (desiredY - gy) * 0.17;
      vx = (vx + ax * dt) * Math.pow(0.76, dt);
      vy = (vy + ay * dt) * Math.pow(0.76, dt);
      gx += vx * dt;
      gy += vy * dt;

      // Yoyo vertical bounce & volume-preserving squash-and-stretch
      const yoyoForce = -yoyoY * 0.21;
      yoyoVy = (yoyoVy + yoyoForce * dt) * Math.pow(0.8, dt);
      yoyoY += yoyoVy * dt;

      const squashForce = -squash * 0.24;
      squashV = (squashV + squashForce * dt) * Math.pow(0.76, dt);
      squash += squashV * dt;

      // Blink scheduler
      let blinkFactor = 1;
      if (blinkStart < 0 && now >= nextBlinkAt && mode !== "confirm") {
        blinkStart = now;
        blinkDuration = 145 + Math.random() * 40;
        if (!pendingDoubleBlink && Math.random() < 0.26) {
          pendingDoubleBlink = true;
        } else {
          pendingDoubleBlink = false;
        }
      }

      if (blinkStart >= 0) {
        const bp = (now - blinkStart) / blinkDuration;
        if (bp >= 1) {
          blinkStart = -1;
          nextBlinkAt = pendingDoubleBlink
            ? now + 110
            : now + 2200 + Math.random() * 2100;
        } else {
          const curve = Math.sin(bp * Math.PI);
          blinkFactor = Math.max(0.06, 1 - curve * 0.94);
        }
      }

      const px = gx * spec.maxTravelX;
      const py = gy * spec.maxTravelY;

      // Combined optical light-refraction vector (phone tilt + gaze + subtle liquid breathing)
      const refractX = Math.max(
        -1.3,
        Math.min(1.3, (tilt.active ? tilt.nx * 0.98 : ambientWaveX) + gx * 0.58)
      );
      const refractY = Math.max(
        -1.3,
        Math.min(1.3, (tilt.active ? tilt.ny * 0.98 : ambientWaveY) + gy * 0.58)
      );

      if (liteNow) {
        // Lite mode: keep crisp 2D bounce + lightweight specular glass reflection shift
        if (shellRef.current) {
          const shellScaleX = 1 - squash * 0.45;
          const shellScaleY = 1 + squash * 0.45;
          shellRef.current.style.transform = `translate3d(0, ${yoyoY.toFixed(2)}px, 0) scale3d(${shellScaleX.toFixed(3)}, ${shellScaleY.toFixed(3)}, 1)`;
        }
        if (meniscusRef.current) {
          meniscusRef.current.style.transform = `translate3d(${(refractX * 8).toFixed(2)}px, 0, 0)`;
        }
        if (domeSheenRef.current) {
          domeSheenRef.current.style.transform = `translate3d(${(-refractX * 9).toFixed(2)}px, 0, 0)`;
        }
      } else {
        // Spring-integrate physical 3D Liquid Glass tilt from DeviceOrientationEvent + subtle gaze weight
        const targetRotX = (tilt.active ? tilt.rotateX : -ambientWaveY * 2.2 * tiltScale) - gy * (3.4 * tiltScale);
        const targetRotY = (tilt.active ? tilt.rotateY : ambientWaveX * 2.8 * tiltScale) + gx * (4.6 * tiltScale);
        const targetRotZ =
          capsuleTilt + (tilt.active ? tilt.rotateZ : ambientWaveX * 1.1 * tiltScale) + gx * (2.2 * tiltScale);

        vRotX = (vRotX + (targetRotX - rotX) * 0.16 * dt) * Math.pow(0.77, dt);
        vRotY = (vRotY + (targetRotY - rotY) * 0.16 * dt) * Math.pow(0.77, dt);
        vRotZ = (vRotZ + (targetRotZ - rotZ) * 0.16 * dt) * Math.pow(0.77, dt);
        rotX += vRotX * dt;
        rotY += vRotY * dt;
        rotZ += vRotZ * dt;

        // Apply compositor-only 3D perspective transforms to outer capsule
        if (shellRef.current) {
          const shellScaleX = 1 - squash * 0.55;
          const shellScaleY = 1 + squash * 0.55;
          const shiftX = gx * 3.2 + (tilt.active ? tilt.nx * 3.8 * tiltScale : 0);
          const shiftY = yoyoY + (tilt.active ? tilt.ny * 2.4 * tiltScale : 0);
          shellRef.current.style.transform = `perspective(560px) translate3d(${shiftX.toFixed(2)}px, ${shiftY.toFixed(2)}px, 0) rotateX(${rotX.toFixed(2)}deg) rotateY(${rotY.toFixed(2)}deg) rotateZ(${rotZ.toFixed(2)}deg) scale3d(${shellScaleX.toFixed(3)}, ${shellScaleY.toFixed(3)}, 1)`;
        }

        // Counter-shifting secondary refraction halo & light ring behind the hero boot capsule
        if (withRearRefraction && (rearRingRef.current || rearHaloRef.current)) {
          const desiredHaloX =
            -(tilt.active ? tilt.nx * 24 : ambientWaveX * 14) - gx * 14;
          const desiredHaloY =
            -(tilt.active ? tilt.ny * 15 : ambientWaveY * 9) - gy * 9 - yoyoY * 0.44;

          // Softer spring stiffness so refracted light trails naturally behind the thick glass
          haloVx = (haloVx + (desiredHaloX - haloX) * 0.105 * dt) * Math.pow(0.79, dt);
          haloVy = (haloVy + (desiredHaloY - haloY) * 0.105 * dt) * Math.pow(0.79, dt);
          haloX += haloVx * dt;
          haloY += haloVy * dt;

          haloPulseV = (haloPulseV - haloPulse * 0.18 * dt) * Math.pow(0.78, dt);
          haloPulse += haloPulseV * dt;

          const counterRotX = -rotX * 0.72;
          const counterRotY = -rotY * 0.72;
          const counterRotZ = -rotZ * 1.4;
          const ringScale = 1 + haloPulse * 0.45 + Math.abs(refractX) * 0.03;

          if (rearRingRef.current) {
            rearRingRef.current.style.transform = `perspective(560px) translate3d(${haloX.toFixed(2)}px, ${haloY.toFixed(2)}px, 0) rotateX(${counterRotX.toFixed(2)}deg) rotateY(${counterRotY.toFixed(2)}deg) rotateZ(${counterRotZ.toFixed(2)}deg) scale3d(${ringScale.toFixed(3)}, ${(1 + haloPulse * 0.35).toFixed(3)}, 1)`;
          }
          if (rearHaloRef.current) {
            const haloScale = 1 + haloPulse * 0.65;
            rearHaloRef.current.style.transform = `translate3d(${(haloX * 1.32).toFixed(2)}px, ${(haloY * 1.28).toFixed(2)}px, 0) rotate(${(counterRotZ * 0.85).toFixed(2)}deg) scale3d(${haloScale.toFixed(3)}, ${haloScale.toFixed(3)}, 1)`;
          }
        }

        if (causticRef.current) {
          // Inverse refraction parallax + counter-roll on Liquid Glass specular rim
          causticRef.current.style.transform = `translate3d(${(-refractX * 19).toFixed(2)}px, ${(-refractY * 11).toFixed(2)}px, 0) rotate(${(-rotZ * 1.4).toFixed(2)}deg)`;
        }

        if (meniscusRef.current) {
          // Specular bevel highlight glides across the top curved glass edge as phone tilts
          meniscusRef.current.style.transform = `translate3d(${(refractX * 12).toFixed(2)}px, ${(refractY * 3.4).toFixed(2)}px, 0)`;
        }

        if (domeSheenRef.current) {
          // Curved crystal dome reflection glides across the front of the visor
          domeSheenRef.current.style.transform = `translate3d(${(-refractX * 14).toFixed(2)}px, ${(-refractY * 5).toFixed(2)}px, 0) rotate(${(-rotZ * 0.9).toFixed(2)}deg)`;
        }

        if (visorGlossRef.current) {
          visorGlossRef.current.style.transform = `translate3d(${(refractX * 7.5).toFixed(2)}px, ${(refractY * 2.4).toFixed(2)}px, 0)`;
        }
      }

      if (eyePairRef.current) {
        eyePairRef.current.style.transform = `translate3d(${px.toFixed(2)}px, ${py.toFixed(2)}px, 0)`;
      }

      const openL = Math.max(0.06, wakeOpen * blinkFactor * leftScaleY);
      const openR = Math.max(0.06, wakeOpen * blinkFactor * rightScaleY);
      const widthCompL = 1 + (1 - openL) * 0.14;
      const widthCompR = 1 + (1 - openR) * 0.14;

      if (leftEyeRef.current) {
        leftEyeRef.current.style.transform = `scale3d(${widthCompL.toFixed(3)}, ${openL.toFixed(3)}, 1)`;
      }
      if (rightEyeRef.current) {
        rightEyeRef.current.style.transform = `scale3d(${widthCompR.toFixed(3)}, ${openR.toFixed(3)}, 1)`;
      }

      const catchX = gx * 2.2 - (!liteNow && tilt.active ? tilt.nx * 1.4 : 0);
      const catchY = gy * 1.8 - (!liteNow && tilt.active ? tilt.ny * 1.1 : 0);
      if (leftCatchRef.current) {
        leftCatchRef.current.style.transform = `translate3d(${catchX.toFixed(2)}px, ${catchY.toFixed(2)}px, 0)`;
      }
      if (rightCatchRef.current) {
        rightCatchRef.current.style.transform = `translate3d(${catchX.toFixed(2)}px, ${catchY.toFixed(2)}px, 0)`;
      }

      rafId = window.requestAnimationFrame(frame);
    };

    rafId = window.requestAnimationFrame(frame);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("touchmove", onTouchMove);
      window.removeEventListener("touchstart", onTouchStart);
    };
  }, [spec.maxTravelX, spec.maxTravelY, tiltRef, tiltScale, withRearRefraction]);

  // Trigger joyful yoyo hop whenever posture switches to "confirm"
  useEffect(() => {
    if (posture === "confirm") {
      tapImpulseRef.current();
    }
  }, [posture]);

  const [sr, sg, sb] = palette.signalRgb;
  const eyeGlow = `0 0 24px rgba(${sr}, ${sg}, ${sb}, 0.86), 0 0 12px rgba(56, 189, 248, 0.62), 0 0 5px rgba(255, 255, 255, 0.78) inset`;
  const eyeGradient = `radial-gradient(62% 62% at 44% 30%, #FFFFFF 0%, ${palette.signalHex} 54%, #38BDF8 84%, rgba(129, 140, 248, 0.92) 100%)`;
  const isConfirm = posture === "confirm";

  const capsuleButton = (
    <button
      ref={shellRef}
      type="button"
      aria-label={ariaLabel}
      onClick={(e) => {
        e.stopPropagation();
        tapImpulseRef.current();
        if (!isLite) {
          setRippleKey((k) => k + 1);
        }
        if (needsPermission && !isLite) {
          void unlockTilt();
        }
        onTap?.();
      }}
      className={`liquid-glass-capsule group relative z-10 inline-flex shrink-0 cursor-pointer items-center justify-center rounded-full select-none will-change-transform focus-visible:outline-none ${spec.shellClass}`}
    >
      {/* Fluid Liquid Glass tap ripple wave */}
      {rippleKey > 0 && !isLite && (
        <span
          key={rippleKey}
          aria-hidden="true"
          className="animate-yoyo-ripple pointer-events-none absolute inset-0 rounded-full bg-white/15 shadow-[0_0_24px_rgba(255,255,255,0.65)]"
        />
      )}
      {/* Pointer- and tilt-reactive colorless crystal Liquid Glass rim caustic refraction */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-0 overflow-hidden rounded-full"
      >
        <div
          ref={causticRef}
          className="absolute -inset-4 opacity-95 will-change-transform"
          style={{
            background: "radial-gradient(50% 56% at 36% 20%, rgba(255,255,255,0.82) 0%, rgba(255,255,255,0.22) 44%, transparent 74%)",
          }}
        >
          {size !== "compact" && !isLite && !lensFailed && (
            <picture className="pointer-events-none absolute inset-1.5 block overflow-hidden rounded-full">
              <source
                type="image/avif"
                srcSet={assetProfile.capsuleAvifSrcSet}
              />
              <source
                type="image/webp"
                srcSet={assetProfile.capsuleWebpSrcSet}
              />
              <img
                src={assetProfile.capsuleJpgSrc}
                alt=""
                decoding="async"
                loading="eager"
                referrerPolicy="no-referrer"
                onError={() => setLensFailed(true)}
                className="h-full w-full rounded-full object-cover mix-blend-screen opacity-70 grayscale"
              />
            </picture>
          )}
        </div>
        {/* High-DPI image-set() glass meniscus coat + tilt-reactive top & bottom crystal rim highlights */}
        {size !== "compact" && !isLite && (
          <div className="liquid-glass-lens-coat absolute inset-0 rounded-full grayscale" />
        )}
        <div
          ref={meniscusRef}
          className="absolute inset-x-[10%] top-[2px] h-[38%] rounded-full bg-gradient-to-b from-white/75 via-white/22 to-transparent will-change-transform"
        />
        <div
          className="absolute inset-x-[16%] bottom-[2px] h-[22%] rounded-full"
          style={{
            background: "linear-gradient(0deg, rgba(255,255,255,0.34) 0%, rgba(255,255,255,0.14) 55%, transparent 100%)",
          }}
        />
      </div>

      {/* Inner Smoked-Obsidian Optical Visor encased beneath curved Liquid Glass dome */}
      <div className={`liquid-glass-visor flex items-center justify-center rounded-full ${spec.visorClass}`}>
        {/* Sweeping optical scan beam while verifying an address */}
        {posture === "scan" && (
          <div
            aria-hidden="true"
            className="animate-yoyo-sheen pointer-events-none absolute inset-y-0 left-0 w-[38%]"
            style={{
              background: "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.24) 50%, transparent 100%)",
            }}
          />
        )}

        {/* Twin Luminous YOYO Eyes */}
        <div
          ref={eyePairRef}
          className="relative z-10 flex items-center justify-center will-change-transform"
          style={{ gap: `${spec.eyeGap}px` }}
        >
          {[
            { eyeRef: leftEyeRef, catchRef: leftCatchRef, key: "left" },
            { eyeRef: rightEyeRef, catchRef: rightCatchRef, key: "right" },
          ].map(({ eyeRef, catchRef, key }) => (
            <div
              key={key}
              ref={eyeRef}
              className="relative flex items-center justify-center overflow-hidden rounded-full will-change-transform"
              style={{
                width: `${spec.eyeWidth}px`,
                height: `${spec.eyeHeight}px`,
                background: isConfirm ? "transparent" : eyeGradient,
                boxShadow: isConfirm ? "none" : eyeGlow,
              }}
            >
              {isConfirm ? (
                /* Expressive MagicOS YOYO happy confirmation crescent eye */
                <svg
                  viewBox="0 0 28 28"
                  className="h-full w-[135%] overflow-visible"
                  fill="none"
                  aria-hidden="true"
                >
                  <path
                    d="M3 18C6.2 9.5 21.8 9.5 25 18"
                    stroke={palette.signalHex}
                    strokeWidth="5"
                    strokeLinecap="round"
                    style={{
                      filter: `drop-shadow(0 0 8px rgba(${sr},${sg},${sb},0.88))`,
                    }}
                  />
                </svg>
              ) : (
                <>
                  {codeInsideEyes && <GlitchEyeCodeStream />}
                  {/* Crisp optical corneal catchlight */}
                  <span
                    ref={catchRef}
                    aria-hidden="true"
                    className="pointer-events-none absolute top-[18%] left-[22%] rounded-full bg-white/95 will-change-transform"
                    style={{
                      width: `${Math.max(3, spec.eyeWidth * 0.28)}px`,
                      height: `${Math.max(3, spec.eyeWidth * 0.28)}px`,
                    }}
                  />
                </>
              )}
            </div>
          ))}
        </div>

        {/* Front curved colorless Liquid Glass crystal dome & moving diagonal refraction sheen */}
        <div
          aria-hidden="true"
          className="liquid-glass-dome pointer-events-none absolute inset-0 z-20 overflow-hidden rounded-full"
        >
          <div
            ref={domeSheenRef}
            className="absolute -inset-x-6 -inset-y-3 will-change-transform"
            style={{
              background: "linear-gradient(115deg, transparent 22%, rgba(255,255,255,0.26) 42%, rgba(255,255,255,0.12) 52%, transparent 66%)",
            }}
          />
          <div
            ref={visorGlossRef}
            className="absolute inset-x-[11%] top-[2px] h-[36%] rounded-full bg-gradient-to-b from-white/34 via-white/10 to-transparent will-change-transform"
          />
        </div>
      </div>
    </button>
  );

  if (!withRearRefraction) {
    return capsuleButton;
  }

  return (
    <div className="relative inline-flex items-center justify-center">
      {showRearLayer && (
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 flex items-center justify-center select-none"
        >
          {/* Soft glowing colorless crystal Liquid Glass aura */}
          {!isLite && (
            <div
              ref={rearHaloRef}
              className="yoyo-refraction-halo absolute h-[156px] w-[288px] shrink-0 rounded-full will-change-transform sm:h-[172px] sm:w-[316px]"
              style={{
                background: `radial-gradient(52% 54% at 50% 50%, rgba(255,255,255,${palette.isDark ? "0.22" : "0.58"}) 0%, rgba(255,255,255,${palette.isDark ? "0.10" : "0.32"}) 46%, transparent 100%)`,
              }}
            />
          )}

          {/* Crisp counter-shifting refracted crystal Liquid Glass light ring behind the hero capsule */}
          <div
            ref={rearRingRef}
            className="yoyo-refraction-ring absolute h-[118px] w-[228px] shrink-0 rounded-full will-change-transform sm:h-[128px] sm:w-[248px]"
            style={{
              background: palette.isDark
                ? "radial-gradient(60% 70% at 50% 50%, transparent 50%, rgba(255,255,255,0.14) 82%, rgba(255,255,255,0.34) 100%)"
                : "radial-gradient(60% 70% at 50% 50%, transparent 50%, rgba(255,255,255,0.45) 82%, rgba(255,255,255,0.92) 100%)",
              boxShadow: palette.isDark
                ? "0 0 0 1.25px rgba(255,255,255,0.32) inset, 0 0 28px -4px rgba(255,255,255,0.26)"
                : "0 0 0 1.5px rgba(255,255,255,0.94) inset, 0 12px 30px -6px rgba(11,17,32,0.16)",
            }}
          >
            {/* Diagonal refracted crystal caustic rim highlights */}
            <div
              className="absolute inset-x-[12%] top-0 h-[2px] rounded-full"
              style={{
                background: `linear-gradient(90deg, transparent 0%, rgba(255,255,255,${palette.isDark ? "0.90" : "1"}) 50%, transparent 100%)`,
              }}
            />
            <div
              className="absolute inset-x-[16%] bottom-0 h-[2px] rounded-full"
              style={{
                background: `linear-gradient(90deg, transparent 0%, rgba(255,255,255,${palette.isDark ? "0.78" : "0.96"}) 50%, transparent 100%)`,
              }}
            />
          </div>
        </div>
      )}

      {capsuleButton}
    </div>
  );
}

/**
 * Unboxed tabular 0x address readout whose characters light up in sequence
 * as the YOYO twin eyes scan across the address.
 */
export function AddressScanReadout({
  address,
  scanning,
}: {
  address?: string;
  scanning: boolean;
}) {
  const [cursor, setCursor] = useState(0);

  const formatted = useMemo(() => {
    if (!address) return "";
    const clean = address.trim();
    if (clean.length <= 16) return clean;
    return `${clean.slice(0, 8)}…${clean.slice(-6)}`;
  }, [address]);

  useEffect(() => {
    if (!scanning || !formatted) return;
    const id = window.setInterval(() => {
      setCursor((c) => (c + 1) % formatted.length);
    }, 65);
    return () => window.clearInterval(id);
  }, [scanning, formatted]);

  if (!formatted) return null;

  return (
    <span className="num inline-flex items-center tracking-tight" aria-label={formatted}>
      {formatted.split("").map((ch, idx) => {
        const lit = scanning && Math.abs(idx - cursor) <= 1;
        return (
          <span
            key={idx}
            className={
              lit
                ? "font-extrabold text-signal transition-colors duration-75"
                : "font-semibold text-stone transition-colors duration-150"
            }
          >
            {ch}
          </span>
        );
      })}
    </span>
  );
}

/**
 * Inline Liquid Glass YOYO stage used directly inside Wallet & HYPE Pass sheets
 * whenever connecting or verifying a 0x address.
 */
export function YoyoVerifyStage({
  posture,
  label,
  sublabel,
  address,
}: {
  posture: VerifyPosture;
  label: string;
  sublabel?: string;
  address?: string;
}) {
  useRegisterInlineVerifyStage(true);
  const theme = useTheme();
  const palette = getThemePalette(theme);

  return (
    <div
      role="status"
      aria-live="polite"
      className="canon-well relative flex flex-col items-center justify-center overflow-hidden rounded-[22px] px-5 py-6 text-center"
    >
      {/* Subtle backlit crystal aura so the translucent Liquid Glass capsule visibly refracts light inside sheets */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute top-2 h-24 w-52 rounded-full"
        style={{
          background: `radial-gradient(50% 50% at 50% 50%, rgba(255,255,255,${palette.isDark ? "0.14" : "0.55"}) 0%, transparent 100%)`,
        }}
      />

      <YoyoLiquidCapsule
        size="stage"
        posture={posture}
        ariaLabel={label}
      />

      <p className="heading-card relative z-10 mt-4 text-[17px] text-ink">{label}</p>

      <div className="relative z-10 mt-1 flex flex-wrap items-center justify-center gap-x-2 gap-y-0.5 text-[13px] text-stone">
        {address && (
          <AddressScanReadout
            address={address}
            scanning={posture === "scan"}
          />
        )}
        {address && sublabel && <span aria-hidden="true">·</span>}
        {sublabel && <span>{sublabel}</span>}
      </div>
    </div>
  );
}

/**
 * Responsive, cellular-aware Liquid Glass optical backdrop for YoyoBootScreen.
 * Uses art-directed mobile (9:16) and desktop (16:9) AVIF/WebP/JPEG ladders on fast links,
 * automatically stepping down to compact 1x assets when Save-Data or slow cellular is active.
 */
function YoyoBootGlassBackdrop() {
  const profile = useYoyoAssetProfile();
  const gfxTier = useGraphicsTier();
  const animateDrift = gfxTier === "full";
  const { tiltRef } = useDeviceTilt({
    maxRotateZ: 2.4,
    sensitivityDeg: 24,
    enabled: animateDrift,
  });
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const imgRef = useRef<HTMLImageElement | null>(null);
  const driftRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (imgRef.current?.complete && imgRef.current.naturalWidth > 0) {
      setLoaded(true);
    }
  }, [profile.tier]);

  useEffect(() => {
    if (!animateDrift) {
      if (driftRef.current) {
        driftRef.current.style.transform = "none";
      }
      return;
    }

    const reduced =
      typeof window !== "undefined" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (reduced) return;

    let rafId = 0;
    let tx = 0;
    let ty = 0;
    let cx = 0;
    let cy = 0;
    let cz = 0;

    const updateTarget = (x: number, y: number) => {
      const vw = Math.max(1, window.innerWidth);
      const vh = Math.max(1, window.innerHeight);
      tx = ((x / vw) - 0.5) * -14;
      ty = ((y / vh) - 0.5) * -10;
    };

    const onPointer = (e: PointerEvent) => updateTarget(e.clientX, e.clientY);
    const onTouch = (e: TouchEvent) => {
      const t = e.touches[0];
      if (t) updateTarget(t.clientX, t.clientY);
    };

    window.addEventListener("pointermove", onPointer, { passive: true });
    window.addEventListener("touchmove", onTouch, { passive: true });

    const tick = () => {
      if (typeof document !== "undefined" && document.hidden) {
        rafId = window.requestAnimationFrame(tick);
        return;
      }

      const tilt = tiltRef.current;
      const targetDriftX = tx + (tilt.active ? -tilt.nx * 12 : 0);
      const targetDriftY = ty + (tilt.active ? -tilt.ny * 9 : 0);
      const targetRotZ = tilt.active ? -tilt.rotateZ : 0;

      cx += (targetDriftX - cx) * 0.08;
      cy += (targetDriftY - cy) * 0.08;
      cz += (targetRotZ - cz) * 0.08;
      if (driftRef.current) {
        driftRef.current.style.transform = `translate3d(${cx.toFixed(2)}px, ${cy.toFixed(2)}px, 0) rotate(${cz.toFixed(2)}deg) scale(1.06)`;
      }
      rafId = window.requestAnimationFrame(tick);
    };

    rafId = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(rafId);
      window.removeEventListener("pointermove", onPointer);
      window.removeEventListener("touchmove", onTouch);
    };
  }, [animateDrift, tiltRef]);

  // Skip full-screen bitmap compositing completely on low-end / lite devices
  if (failed || gfxTier === "lite") return null;

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 overflow-hidden select-none"
    >
      <div
        ref={driftRef}
        className={`yoyo-boot-optics h-full w-full transition-opacity duration-500 ease-out will-change-[transform,opacity] ${
          loaded ? "opacity-100" : "opacity-0"
        }`}
      >
        <picture className="block h-full w-full">
          {/* Mobile-first portrait optical glass caustics (9:16) */}
          <source
            media="(max-width: 767px)"
            type="image/avif"
            srcSet={profile.mobileAvifSrcSet}
            sizes={profile.sizes}
          />
          <source
            media="(max-width: 767px)"
            type="image/webp"
            srcSet={profile.mobileWebpSrcSet}
            sizes={profile.sizes}
          />
          <source
            media="(max-width: 767px)"
            type="image/jpeg"
            srcSet={profile.mobileJpgSrcSet}
            sizes={profile.sizes}
          />

          {/* Wide viewport landscape optical glass caustics (16:9) */}
          <source
            media="(min-width: 768px)"
            type="image/avif"
            srcSet={profile.desktopAvifSrcSet}
            sizes={profile.sizes}
          />
          <source
            media="(min-width: 768px)"
            type="image/webp"
            srcSet={profile.desktopWebpSrcSet}
            sizes={profile.sizes}
          />
          <source
            media="(min-width: 768px)"
            type="image/jpeg"
            srcSet={profile.desktopJpgSrcSet}
            sizes={profile.sizes}
          />

          <img
            ref={imgRef}
            src={profile.fallbackSrc}
            alt=""
            fetchPriority="high"
            decoding="async"
            loading="eager"
            referrerPolicy="no-referrer"
            onLoad={() => setLoaded(true)}
            onError={() => setFailed(true)}
            className="h-full w-full object-cover object-center"
          />
        </picture>
      </div>
    </div>
  );
}

/**
 * Full-screen Liquid Glass YOYO loading experience on every CANON open,
 * synced to live Elysium contract + Vault + Lens reads.
 */
export function YoyoBootScreen() {
  const { boot } = useYoyoLoader();
  const gfxTier = useGraphicsTier();
  const isLite = gfxTier === "lite";
  const { status: tiltStatus, needsPermission, unlockTilt } = useDeviceTilt({
    enabled: !isLite,
  });
  const [canQuickEnter, setCanQuickEnter] = useState(false);

  useEffect(() => {
    if (!boot.active) return;
    const t = window.setTimeout(() => setCanQuickEnter(true), 850);
    return () => window.clearTimeout(t);
  }, [boot.active]);

  if (!boot.active) return null;

  const hintText = boot.ready
    ? "Entering Vault…"
    : !isLite && needsPermission
      ? "Tap eye to enable phone tilt · Drag finger to look"
      : !isLite && tiltStatus === "active"
        ? "Tilt phone or drag finger · Tap eye to bounce"
        : "Move finger or cursor · Tap eye to bounce";

  return (
    <div
      role="status"
      aria-live="polite"
      aria-label="Loading CANON live index"
      className={`liquid-glass-veil fixed inset-0 z-[90] flex flex-col items-center justify-between overflow-hidden px-6 py-8 transition-[opacity,transform] duration-300 ease-[cubic-bezier(0.16,1,0.3,1)] will-change-[opacity,transform] ${
        boot.exiting ? "pointer-events-none scale-[1.06] opacity-0" : "scale-100 opacity-100"
      }`}
    >
      {/* Responsive High-DPI / Cellular-Aware Liquid Glass Optical Backdrop */}
      <YoyoBootGlassBackdrop />

      {/* Top quiet brand anchor */}
      <div className="relative z-10 flex items-center justify-center pt-2 opacity-90">
        <CanonWordmark />
      </div>

      {/* Center MagicOS Liquid Glass YOYO Twin-Eye Stage */}
      <div className="relative z-10 flex flex-col items-center text-center">
        <YoyoLiquidCapsule
          size="hero"
          withRearRefraction
          posture={boot.ready ? "confirm" : "idle"}
          ariaLabel="YOYO eye loader — tilt phone, move finger, or tap to bounce"
          onTap={() => {
            if (boot.ready || canQuickEnter) {
              completeBootSequence();
            }
          }}
        />

        {/* Thin Liquid Glass progress filament (compositor scaleX only) */}
        <div className="mt-7 h-[3px] w-40 overflow-hidden rounded-full bg-line/70">
          <div
            className="h-full w-full origin-left rounded-full bg-signal transition-transform duration-300 ease-out will-change-transform"
            style={{ transform: `scaleX(${Math.max(0.12, Math.min(1, boot.progress))})` }}
          />
        </div>

        <p className="heading-card mt-4 text-[21px] text-ink sm:text-[23px]">
          {boot.label}
        </p>

        <p className="num mt-1.5 text-[12.5px] font-medium text-stone">
          {boot.detail}
        </p>
      </div>

      {/* Bottom tactile hint */}
      <div className="relative z-10 pb-2 text-center">
        <button
          type="button"
          onClick={() => {
            if (!isLite && needsPermission) {
              void unlockTilt();
              return;
            }
            if (boot.ready || canQuickEnter) {
              completeBootSequence();
            }
          }}
          className="min-h-[44px] cursor-pointer px-4 text-[12.5px] font-semibold text-stone transition-colors hover:text-ink"
        >
          {hintText}
        </button>
      </div>
    </div>
  );
}

/**
 * Dynamic top Liquid Glass Capsule that glides down automatically
 * whenever verifying a 0x wallet or token address outside an open stage sheet.
 */
export function YoyoVerifyOverlay() {
  const { boot, verify, inlineStageCount } = useYoyoLoader();

  if (!verify.active || boot.active || inlineStageCount > 0) {
    return null;
  }

  return (
    <div className="pointer-events-none fixed inset-x-0 top-3 z-[95] flex justify-center px-4">
      <div
        role="status"
        aria-live="polite"
        onClick={() => dismissAddressVerify()}
        className="animate-capsule-drop liquid-glass-capsule pointer-events-auto flex min-h-[54px] max-w-full cursor-pointer items-center gap-3.5 rounded-full py-1.5 pr-5 pl-2"
      >
        <YoyoLiquidCapsule
          size="compact"
          posture={verify.posture}
          ariaLabel={verify.label}
        />

        <div className="min-w-0 text-left">
          <p className="truncate text-[13.5px] font-extrabold tracking-tight text-ink">
            {verify.label}
          </p>
          <div className="flex items-center gap-1.5 text-[11.5px] text-stone">
            {verify.address && (
              <AddressScanReadout
                address={verify.address}
                scanning={verify.posture === "scan"}
              />
            )}
            {verify.address && verify.sublabel && <span aria-hidden="true">·</span>}
            {verify.sublabel && <span className="truncate">{verify.sublabel}</span>}
          </div>
        </div>
      </div>
    </div>
  );
}

const IDLE_TRIGGER_MS = 10_000;

/**
 * After 10 seconds of screen idle, all page texts are hidden and only the
 * YOYO Liquid Glass capsule with live codes running inside its eyes appears
 * at the center of the screen. Any user activity restores the screen immediately.
 */
export function YoyoIdleEyesOverlay() {
  const { boot, idle } = useYoyoLoader();

  useEffect(() => {
    if (boot.active) return;

    let idleTimer: number | null = null;

    const scheduleIdle = () => {
      if (idleTimer) window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => {
        if (document.hidden) {
          scheduleIdle();
          return;
        }
        setScreenIdle(true);
      }, IDLE_TRIGGER_MS);
    };

    const onActivity = () => {
      setScreenIdle(false);
      scheduleIdle();
    };

    scheduleIdle();

    const events: ReadonlyArray<keyof WindowEventMap> = [
      "pointerdown",
      "pointermove",
      "touchstart",
      "touchmove",
      "wheel",
      "keydown",
      "scroll",
    ];
    events.forEach((ev) => window.addEventListener(ev, onActivity, { passive: true }));

    return () => {
      if (idleTimer) window.clearTimeout(idleTimer);
      events.forEach((ev) => window.removeEventListener(ev, onActivity));
    };
  }, [boot.active]);

  if (!idle || boot.active) {
    return null;
  }

  return (
    <div
      aria-hidden="true"
      className="pointer-events-none fixed inset-0 z-[92] flex items-center justify-center overflow-hidden select-none"
    >
      <YoyoLiquidCapsule
        size="hero"
        posture="idle"
        codeInsideEyes
        ariaLabel=""
      />
    </div>
  );
}
