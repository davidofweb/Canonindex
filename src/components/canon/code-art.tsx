import { type CSSProperties, useEffect, useMemo, useRef, useState } from "react";
import { keccak256 } from "viem";
import { OUR_CODE, PACKED_CODE } from "@/lib/our-code";
import { getThemePalette, useTheme } from "@/lib/theme";

const SCRAMBLE_CHARS = "{}[]()<>/\\|=+-*&%$#@!?;:0123456789abcdefx";
const randGlyph = () => SCRAMBLE_CHARS[(Math.random() * SCRAMBLE_CHARS.length) | 0];

function isReducedMotion(): boolean {
  return typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;
}

function detNoise(a: number, b: number, c: number): number {
  let h = (a * 374761393 + b * 668265263 + c * 2147483647) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}

function glyphWidthRatio(ctx: CanvasRenderingContext2D, family: string, weight: number): number {
  ctx.font = `${weight} 100px ${family}`;
  return ctx.measureText("M").width / 100 || 0.6;
}

function sizeHiDpiCanvas(canvas: HTMLCanvasElement, w: number, h: number): CanvasRenderingContext2D {
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  canvas.width = Math.max(1, Math.round(w * dpr));
  canvas.height = Math.max(1, Math.round(h * dpr));
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext("2d")!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

/* ============================================================================
 * 1. GEOMETRIC CONCENTRIC VAULT MARK + THICK DISPLAY WORDMARK
 * ========================================================================== */

export function CanonWordmark({
  compact = false,
  className = "",
}: {
  compact?: boolean;
  className?: string;
}) {
  const iconPx = compact ? 18 : 24;
  return (
    <span className={`inline-flex items-center gap-2 select-none ${className}`}>
      <svg
        width={iconPx}
        height={iconPx}
        viewBox="0 0 28 28"
        fill="none"
        aria-hidden="true"
        className="shrink-0"
      >
        {/* Outer precision vault ring with right-side aperture */}
        <path
          d="M22.2 8.2A10 10 0 1 0 22.2 19.8"
          stroke="currentColor"
          strokeWidth="2.9"
          strokeLinecap="round"
        />
        {/* Inner index ring */}
        <path
          d="M18.6 10.7A5.6 5.6 0 1 0 18.6 17.3"
          stroke="currentColor"
          strokeWidth="2.3"
          strokeLinecap="round"
          opacity="0.52"
        />
        {/* Signal core node */}
        <circle cx="14" cy="14" r="2.4" className="fill-signal" />
        {/* Right-side signal lock bar */}
        <rect x="19.5" y="12.75" width="5.5" height="2.5" rx="1.25" className="fill-signal" />
      </svg>
      <span
        className={`font-extrabold tracking-[-0.045em] text-ink ${
          compact ? "text-[14.5px]" : "text-[18.5px]"
        }`}
      >
        CANON
      </span>
    </span>
  );
}

/* ============================================================================
 * 2. CODE SCRAMBLE TEXT (Monospace Glyph-Resolve on Value Changes)
 * ========================================================================== */

export function CodeScramble({
  value,
  className = "",
  durationMs = 210,
}: {
  value: string;
  className?: string;
  durationMs?: number;
}) {
  const [shown, setShown] = useState(value);
  const prevRef = useRef(value);

  useEffect(() => {
    if (prevRef.current === value) return;
    prevRef.current = value;
    if (isReducedMotion()) {
      setShown(value);
      return;
    }

    const start = performance.now();
    let raf = 0;

    const step = (now: number) => {
      const p = Math.min(1, (now - start) / durationMs);
      if (p >= 1) {
        setShown(value);
        return;
      }
      const lockCount = Math.floor(p * value.length);
      let next = "";
      for (let i = 0; i < value.length; i++) {
        const ch = value[i];
        if (i < lockCount || ch === " " || ch === "·" || ch === "." || ch === "%" || ch === "$") {
          next += ch;
        } else {
          next += randGlyph();
        }
      }
      setShown(next);
      raf = window.requestAnimationFrame(step);
    };

    raf = window.requestAnimationFrame(step);
    return () => window.cancelAnimationFrame(raf);
  }, [value, durationMs]);

  return <span className={className}>{shown}</span>;
}

/* ============================================================================
 * 3. THEME-REACTIVE FALLING CODE RAIN (Multi-Depth Contract Streams + Signal Head)
 * ========================================================================== */

export function AmbientCodeRain({
  className = "",
  style,
}: {
  className?: string;
  style?: CSSProperties;
}) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const theme = useTheme();
  const themeRef = useRef(theme);
  themeRef.current = theme;

  useEffect(() => {
    const canvas = canvasRef.current;
    const host = canvas?.parentElement;
    if (!canvas || !host) return;

    const reduce = isReducedMotion();
    const codeChars =
      PACKED_CODE.length > 80
        ? PACKED_CODE
        : "contractCanonVault{functionroute(uint256in)external{vault.buyTopTen();burnSink.burn();}}";

    let ctx = canvas.getContext("2d")!;
    const family = '"JetBrains Mono", "Geist Mono", monospace';
    const fontPx = 11;
    const rowH = 16;
    const colSpacing = 24;
    let w = 0;
    let h = 0;
    let raf = 0;
    let visible = true;
    const t0 = performance.now();

    const resize = () => {
      w = Math.max(1, host.clientWidth);
      h = Math.max(1, host.clientHeight);
      ctx = sizeHiDpiCanvas(canvas, w, h);
    };

    const draw = (now: number) => {
      if (!w || !h) return;
      const pal = getThemePalette(themeRef.current);
      const [ir, ig, ib] = pal.inkRgb;
      const [sr, sg, sb] = pal.signalRgb;

      const elapsed = reduce ? 12 : (now - t0) / 1000;
      const tick = Math.floor(now / 85);
      const cols = Math.max(8, Math.floor(w / colSpacing));
      const rows = Math.ceil(h / rowH) + 4;
      const xStart = (w - (cols - 1) * colSpacing) * 0.5;

      ctx.clearRect(0, 0, w, h);
      ctx.font = `600 ${fontPx}px ${family}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      const trailAlphaScale = pal.isDark ? 0.14 : 0.095;
      const headAlphaScale = pal.isDark ? 0.55 : 0.42;

      for (let c = 0; c < cols; c++) {
        // Deterministic per-column velocity, trail length, and phase
        const seed = detNoise(c, 17, 5);
        const colSpeed = 2.4 + seed * 3.8; // rows per second
        const trailLen = 8 + Math.floor(detNoise(c, 31, 9) * 14);
        const cycle = rows + trailLen + 6;
        const headRow = (elapsed * colSpeed + seed * cycle * 2.5) % cycle;
        const x = xStart + c * colSpacing;

        for (let r = 0; r < rows; r++) {
          const dist = headRow - r;
          if (dist < 0 || dist > trailLen) continue;

          const y = r * rowH + rowH * 0.5;
          const charSeed = (c * 53 + r * 19) % codeChars.length;
          const isHead = dist < 1.15;
          const nearHead = dist < 2.6;

          const ch =
            isHead && !reduce
              ? SCRAMBLE_CHARS[(charSeed + tick) % SCRAMBLE_CHARS.length]
              : codeChars[charSeed];

          if (isHead) {
            ctx.fillStyle = `rgba(${sr}, ${sg}, ${sb}, ${headAlphaScale})`;
          } else if (nearHead) {
            const blend = 1 - (dist - 1.15) / 1.45;
            ctx.fillStyle = `rgba(${sr}, ${sg}, ${sb}, ${trailAlphaScale + blend * 0.18})`;
          } else {
            const fade = Math.max(0, 1 - dist / trailLen);
            ctx.fillStyle = `rgba(${ir}, ${ig}, ${ib}, ${fade * fade * trailAlphaScale})`;
          }

          ctx.fillText(ch, x, y);
        }
      }
    };

    const loop = (now: number) => {
      raf = 0;
      if (!visible) return;
      draw(now);
      if (!reduce) raf = window.requestAnimationFrame(loop);
    };

    let cancelled = false;
    document.fonts
      .load(`600 ${fontPx}px ${family}`)
      .catch(() => [])
      .then(() => {
        if (cancelled) return;
        void glyphWidthRatio(ctx, family, 600);
        resize();
        draw(performance.now());
        if (!reduce) raf = window.requestAnimationFrame(loop);
      });

    const ro = new ResizeObserver(() => {
      resize();
      draw(performance.now());
    });
    ro.observe(host);

    const io = new IntersectionObserver(([entry]) => {
      visible = entry?.isIntersecting ?? true;
      if (visible && !raf && !reduce) raf = window.requestAnimationFrame(loop);
    });
    io.observe(host);

    return () => {
      cancelled = true;
      window.cancelAnimationFrame(raf);
      ro.disconnect();
      io.disconnect();
    };
  }, []);

  // Trigger immediate redraw if reduced motion is active and user switches theme
  useEffect(() => {
    void OUR_CODE;
  }, [theme]);

  return <canvas ref={canvasRef} aria-hidden="true" className={className} style={style} />;
}

/* ============================================================================
 * 4. MAGNETIC 3D CODE SPHERE (Theme-Synced Volumetric Code Core)
 * ========================================================================== */

type CorePoint = {
  theta: number;
  phi: number;
  charIdx: number;
  ring: number;
};

type StreamParticle = {
  side: "buy" | "sell";
  t: number;
  speed: number;
  lane: number;
  charOffset: number;
  drift: number;
};

export function MagneticCodeCore({
  activeMode = "both",
  burnedTotal,
  className = "",
}: {
  activeMode?: "both" | "buy" | "sell";
  burnedTotal?: number | null;
  className?: string;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const pointerRef = useRef<{ x: number; y: number; active: boolean }>({ x: 0.5, y: 0.5, active: false });
  const modeRef = useRef(activeMode);
  modeRef.current = activeMode;

  const theme = useTheme();
  const themeRef = useRef(theme);
  themeRef.current = theme;

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const code =
      PACKED_CODE.length > 64
        ? PACKED_CODE
        : "contractCanonVault{functionroute(uint256in)external{vault.buy();burnSink.burn();}}";

    const N = 280;
    const golden = Math.PI * (3 - Math.sqrt(5));
    const spherePoints: CorePoint[] = [];
    for (let i = 0; i < N; i++) {
      const y = 1 - (i / (N - 1)) * 2;
      const phi = Math.acos(Math.max(-1, Math.min(1, y)));
      const theta = golden * i;
      spherePoints.push({
        theta,
        phi,
        charIdx: (i * 7) % code.length,
        ring: i % 9,
      });
    }

    const streams: StreamParticle[] = [];
    for (let i = 0; i < 72; i++) {
      streams.push({
        side: i < 38 ? "buy" : "sell",
        t: (i * 0.027) % 1,
        speed: 0.13 + (i % 7) * 0.017,
        lane: ((i % 5) - 2) / 2,
        charOffset: (i * 19) % code.length,
        drift: ((i * 31) % 100) / 100,
      });
    }

    const reducedMotion = isReducedMotion();
    let width = 0;
    let height = 0;
    let visible = true;
    let rafId = 0;
    let lastTs = performance.now();
    let elapsed = 10;

    const resize = () => {
      const rect = wrap.getBoundingClientRect();
      width = Math.max(280, Math.floor(rect.width));
      height = Math.max(220, Math.floor(rect.height));
      sizeHiDpiCanvas(canvas, width, height);
    };

    const drawFrame = (dt: number) => {
      if (!width || !height) return;
      elapsed += reducedMotion ? 0 : dt;

      const pal = getThemePalette(themeRef.current);
      const [ir, ig, ib] = pal.inkRgb;
      const [mr, mg, mb] = pal.stoneRgb;
      const [sr, sg, sb] = pal.signalRgb;

      ctx.clearRect(0, 0, width, height);

      const cx = width * 0.5;
      const cy = height * 0.5;
      const radius = Math.min(width * 0.24, height * 0.4, 112);

      const ptr = pointerRef.current;
      const px = ptr.active ? ptr.x * width : cx;
      const py = ptr.active ? ptr.y * height : cy;
      const tiltY = ptr.active ? (ptr.x - 0.5) * 0.6 : 0;
      const tiltX = ptr.active ? (ptr.y - 0.5) * 0.44 : 0.2;

      const curMode = modeRef.current;
      const buyBoost = curMode === "sell" ? 0.25 : 1;
      const sellBoost = curMode === "buy" ? 0.25 : 1;

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      // Architectural hairline orbit
      ctx.strokeStyle = `rgba(${ir}, ${ig}, ${ib}, ${pal.isDark ? 0.12 : 0.08})`;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.ellipse(cx, cy, radius * 1.32, radius * 0.34, -0.12 + tiltY * 0.2, 0, Math.PI * 2);
      ctx.stroke();

      // 1. Dual Bezier Contract Streams (Left = Ink Buy Stream -> Vault, Right = Signal Burn Stream)
      const streamFontPx = width < 480 ? 10 : 11;
      ctx.font = `600 ${streamFontPx}px "JetBrains Mono", "Geist Mono", monospace`;

      for (const s of streams) {
        const u = (s.t + elapsed * s.speed) % 1;
        const ch =
          u < 0.22
            ? SCRAMBLE_CHARS[(s.charOffset + Math.floor(elapsed * 9)) % SCRAMBLE_CHARS.length]
            : code[(s.charOffset + Math.floor(elapsed * 4)) % code.length];

        if (s.side === "buy") {
          const x0 = 8;
          const y0 = cy + s.lane * radius * 1.05;
          const x1 = cx - radius * 1.65;
          const y1 = cy + s.lane * radius * 0.42 + Math.sin(elapsed * 1.4 + s.drift * 6) * 8;
          const x2 = cx - radius * 0.84;
          const y2 = cy + s.lane * radius * 0.2;

          const inv = 1 - u;
          let sx = inv * inv * x0 + 2 * inv * u * x1 + u * u * x2;
          let sy = inv * inv * y0 + 2 * inv * u * y1 + u * u * y2;

          if (ptr.active) {
            const dx = sx - px;
            const dy = sy - py;
            const distSq = dx * dx + dy * dy;
            if (distSq < 7800 && distSq > 1) {
              const push = (1 - distSq / 7800) * 18;
              const d = Math.sqrt(distSq);
              sx += (dx / d) * push;
              sy += (dy / d) * push;
            }
          }

          const alpha = Math.sin(u * Math.PI) * 0.72 * buyBoost;
          ctx.fillStyle = `rgba(${ir}, ${ig}, ${ib}, ${alpha})`;
          ctx.fillText(ch, sx, sy);
        } else {
          const x0 = cx + radius * 0.8;
          const y0 = cy + s.lane * radius * 0.24;
          const x1 = cx + radius * 1.58;
          const y1 = cy + s.lane * radius * 0.45 - u * 30;
          const x2 = width - 8;
          const y2 = cy + s.lane * radius * 0.88 - 44 * (0.4 + s.drift);

          const inv = 1 - u;
          let sx = inv * inv * x0 + 2 * inv * u * x1 + u * u * x2;
          let sy = inv * inv * y0 + 2 * inv * u * y1 + u * u * y2;

          if (ptr.active) {
            const dx = sx - px;
            const dy = sy - py;
            const distSq = dx * dx + dy * dy;
            if (distSq < 7800 && distSq > 1) {
              const push = (1 - distSq / 7800) * 18;
              const d = Math.sqrt(distSq);
              sx += (dx / d) * push;
              sy += (dy / d) * push;
            }
          }

          const fade = (1 - u * 0.86) * Math.min(1, u * 4.5) * sellBoost;
          ctx.fillStyle = `rgba(${sr}, ${sg}, ${sb}, ${fade * 0.92})`;
          ctx.fillText(u > 0.72 ? SCRAMBLE_CHARS[(s.charOffset + Math.floor(elapsed * 12)) % 16] : ch, sx, sy);
        }
      }

      // 2. 3D Volumetric Code Sphere
      const spin = elapsed * 0.4 + tiltY;
      const cosSpin = Math.cos(spin);
      const sinSpin = Math.sin(spin);
      const cosTilt = Math.cos(tiltX);
      const sinTilt = Math.sin(tiltX);

      const projected: Array<{ x: number; y: number; z: number; ch: string; hot: boolean }> = [];

      for (const p of spherePoints) {
        const sinPhi = Math.sin(p.phi);
        const rawX = sinPhi * Math.cos(p.theta);
        const rawY = Math.cos(p.phi);
        const rawZ = sinPhi * Math.sin(p.theta);

        const rx = rawX * cosSpin - rawZ * sinSpin;
        const rz1 = rawX * sinSpin + rawZ * cosSpin;
        const ry = rawY * cosTilt - rz1 * sinTilt;
        const rz = rawY * sinTilt + rz1 * cosTilt;

        const perspective = 1 / (1 - rz * 0.24);
        let sx = cx + rx * radius * perspective;
        let sy = cy + ry * radius * perspective;

        if (ptr.active) {
          const dx = sx - px;
          const dy = sy - py;
          const distSq = dx * dx + dy * dy;
          if (distSq < 6200 && distSq > 1) {
            const push = (1 - distSq / 6200) * 13;
            const d = Math.sqrt(distSq);
            sx += (dx / d) * push;
            sy += (dy / d) * push;
          }
        }

        const hot =
          (curMode === "sell" && rx > 0.22 && rz > 0) ||
          (curMode !== "buy" && rx > 0.65 && rz > 0.15 && p.ring % 3 === 0);

        projected.push({ x: sx, y: sy, z: rz, ch: code[p.charIdx], hot });
      }

      projected.sort((a, b) => a.z - b.z);

      const baseGlyph = width < 480 ? 9.5 : 11;
      for (const g of projected) {
        const depth = (g.z + 1) * 0.5;
        if (depth < 0.1) continue;

        if (g.hot) {
          ctx.font = `700 ${Math.round(baseGlyph + 1.5)}px "JetBrains Mono", "Geist Mono", monospace`;
          ctx.fillStyle = `rgba(${sr}, ${sg}, ${sb}, ${0.58 + depth * 0.42})`;
        } else if (depth > 0.72) {
          ctx.font = `700 ${Math.round(baseGlyph + 1)}px "JetBrains Mono", "Geist Mono", monospace`;
          ctx.fillStyle = `rgba(${ir}, ${ig}, ${ib}, ${0.65 + (depth - 0.72) * 1.25})`;
        } else if (depth > 0.44) {
          ctx.font = `500 ${Math.round(baseGlyph)}px "JetBrains Mono", "Geist Mono", monospace`;
          ctx.fillStyle = `rgba(${mr}, ${mg}, ${mb}, ${0.26 + depth * 0.45})`;
        } else {
          ctx.font = `400 ${Math.round(baseGlyph - 1)}px "JetBrains Mono", "Geist Mono", monospace`;
          ctx.fillStyle = `rgba(${mr}, ${mg}, ${mb}, ${0.14 + depth * 0.18})`;
        }
        ctx.fillText(g.ch, g.x, g.y);
      }
    };

    const tick = (now: number) => {
      const dt = Math.min(0.05, (now - lastTs) / 1000);
      lastTs = now;
      if (visible) drawFrame(dt);
      if (!reducedMotion) rafId = window.requestAnimationFrame(tick);
    };

    resize();
    drawFrame(0);
    if (!reducedMotion) rafId = window.requestAnimationFrame(tick);

    const ro = new ResizeObserver(() => {
      resize();
      drawFrame(0);
    });
    ro.observe(wrap);

    const io = new IntersectionObserver(
      (entries) => {
        visible = entries[0]?.isIntersecting ?? true;
      },
      { threshold: 0.05 },
    );
    io.observe(wrap);

    return () => {
      window.cancelAnimationFrame(rafId);
      ro.disconnect();
      io.disconnect();
    };
  }, [theme]);

  const updatePointer = (clientX: number, clientY: number) => {
    const rect = wrapRef.current?.getBoundingClientRect();
    if (!rect) return;
    pointerRef.current = {
      x: Math.max(0, Math.min(1, (clientX - rect.left) / rect.width)),
      y: Math.max(0, Math.min(1, (clientY - rect.top) / rect.height)),
      active: true,
    };
  };

  return (
    <div
      ref={wrapRef}
      onPointerMove={(e) => updatePointer(e.clientX, e.clientY)}
      onPointerDown={(e) => updatePointer(e.clientX, e.clientY)}
      onPointerLeave={() => {
        pointerRef.current.active = false;
      }}
      className={`relative h-[230px] w-full select-none sm:h-[260px] lg:h-[280px] ${className}`}
    >
      <canvas ref={canvasRef} className="block h-full w-full touch-pan-y cursor-crosshair" aria-hidden="true" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex items-center justify-between text-[11px] uppercase tracking-[0.08em] text-stone">
        <span className="num font-semibold text-ink">buys -&gt; vault</span>
        <span className="num hidden sm:inline">
          {burnedTotal && burnedTotal > 0
            ? `${Math.round(burnedTotal).toLocaleString("en-US")} burned`
            : "1.00% locked fee"}
        </span>
        <span className="num font-semibold text-signal">sells -&gt; burn</span>
      </div>
    </div>
  );
}

/* ============================================================================
 * 5. 10-RING RADIAL CODE VAULT (Theme-Synced Interactive Code Dial)
 * ========================================================================== */

export type VaultSlice = {
  token: string;
  symbol: string;
  weightPct: number;
  votedSeat?: boolean;
};

export function RadialCodeVault({
  coins,
  selectedIndex,
  onSelect,
}: {
  coins: VaultSlice[];
  selectedIndex: number;
  onSelect: (index: number) => void;
}) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [hovered, setHovered] = useState<number | null>(null);
  const theme = useTheme();

  const segments = useMemo(() => {
    const total = coins.reduce((acc, c) => acc + c.weightPct, 0) || 100;
    let cursor = -Math.PI / 2;
    const gap = 0.04;
    return coins.map((c, idx) => {
      const span = (c.weightPct / total) * Math.PI * 2;
      const start = cursor + gap * 0.5;
      const end = cursor + Math.max(gap, span - gap * 0.5);
      cursor += span;
      return { ...c, idx, start, end };
    });
  }, [coins]);

  useEffect(() => {
    const wrap = wrapRef.current;
    const canvas = canvasRef.current;
    if (!wrap || !canvas) return;

    const pal = getThemePalette(theme);
    const code = PACKED_CODE.length > 64 ? PACKED_CODE : "contractIndexVault{uint256weight;addresscoin;}";

    const render = () => {
      const rect = wrap.getBoundingClientRect();
      const size = Math.max(250, Math.min(Math.floor(rect.width), 356));
      const ctx = sizeHiDpiCanvas(canvas, size, size);
      ctx.clearRect(0, 0, size, size);

      const cx = size / 2;
      const cy = size / 2;
      const outerR = size * 0.455;
      const innerR = size * 0.265;
      const rings = 5;

      ctx.textAlign = "center";
      ctx.textBaseline = "middle";

      let charCursor = 0;

      for (const seg of segments) {
        const isSelected = seg.idx === selectedIndex;
        const isHover = seg.idx === hovered;

        for (let r = 0; r < rings; r++) {
          const radius = innerR + ((r + 0.5) / rings) * (outerR - innerR) + (isSelected ? 3 : 0);
          const arcLen = Math.max(0, (seg.end - seg.start) * radius);
          const stepPx = size < 300 ? 7.8 : 8.5;
          const count = Math.max(2, Math.floor(arcLen / stepPx));

          for (let k = 0; k < count; k++) {
            const angle = seg.start + ((k + 0.5) / count) * (seg.end - seg.start);
            const x = cx + Math.cos(angle) * radius;
            const y = cy + Math.sin(angle) * radius;
            const ch = code[charCursor++ % code.length];

            ctx.save();
            ctx.translate(x, y);
            ctx.rotate(angle + Math.PI / 2);

            if (isSelected) {
              ctx.font = `700 10px "JetBrains Mono", "Geist Mono", monospace`;
              ctx.fillStyle = seg.votedSeat ? pal.forestHex : pal.signalHex;
            } else if (isHover) {
              ctx.font = `700 9.5px "JetBrains Mono", "Geist Mono", monospace`;
              ctx.fillStyle = pal.inkHex;
            } else if (seg.votedSeat) {
              ctx.font = `600 9px "JetBrains Mono", "Geist Mono", monospace`;
              ctx.fillStyle = pal.forestHex;
            } else {
              ctx.font = `500 9px "JetBrains Mono", "Geist Mono", monospace`;
              ctx.fillStyle = r % 2 === 0 ? pal.inkHex : pal.stoneHex;
            }

            ctx.fillText(ch, 0, 0);
            ctx.restore();
          }
        }
      }

      ctx.beginPath();
      ctx.arc(cx, cy, innerR - 10, 0, Math.PI * 2);
      ctx.strokeStyle = pal.lineHex;
      ctx.lineWidth = 1;
      ctx.stroke();
    };

    render();
    const ro = new ResizeObserver(render);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, [segments, selectedIndex, hovered, theme]);

  const pickAt = (clientX: number, clientY: number, commit: boolean) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const dx = clientX - (rect.left + rect.width / 2);
    const dy = clientY - (rect.top + rect.height / 2);
    const dist = Math.sqrt(dx * dx + dy * dy);
    const minR = rect.width * 0.19;
    const maxR = rect.width * 0.49;
    if (dist < minR || dist > maxR) {
      if (!commit) setHovered(null);
      return;
    }
    let angle = Math.atan2(dy, dx);
    if (angle < -Math.PI / 2) angle += Math.PI * 2;
    const hit = segments.find((s) => angle >= s.start - 0.02 && angle <= s.end + 0.02);
    if (hit) {
      if (commit) onSelect(hit.idx);
      else setHovered(hit.idx);
    }
  };

  const activeCoin = coins[selectedIndex] ?? coins[0];

  return (
    <div ref={wrapRef} className="relative flex w-full items-center justify-center py-1">
      <canvas
        ref={canvasRef}
        onClick={(e) => pickAt(e.clientX, e.clientY, true)}
        onPointerMove={(e) => pickAt(e.clientX, e.clientY, false)}
        onPointerLeave={() => setHovered(null)}
        className="cursor-pointer touch-manipulation"
        aria-label="Interactive 10-coin Vault code ring"
      />
      {activeCoin && (
        <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center text-center">
          <span className="ui-label text-[9.5px]">
            {activeCoin.votedSeat ? "Ballot Seat" : `Seat ${String(selectedIndex + 1).padStart(2, "0")}`}
          </span>
          <span className="heading-section mt-0.5 text-[24px] text-ink">
            <CodeScramble value={activeCoin.symbol} />
          </span>
          <span className="num mt-0.5 text-[13.5px] font-bold text-signal">
            <CodeScramble value={`${activeCoin.weightPct.toFixed(2)}%`} />
          </span>
        </div>
      )}
    </div>
  );
}

/* ============================================================================
 * 6. DETERMINISTIC GEOMETRIC WALLET SIGIL (Replaces Pantheon Character PNGs)
 * ========================================================================== */

export function CanonWalletSigil({
  address,
  size = 48,
  className = "",
}: {
  address: string;
  size?: number;
  className?: string;
}) {
  const cells = useMemo(() => {
    const clean = (address || "0x0000000000000000000000000000000000000000").toLowerCase() as `0x${string}`;
    const hash = keccak256(clean).slice(2);
    const out: Array<{ x: number; y: number; tone: "signal" | "ink" }> = [];

    for (let y = 0; y < 5; y++) {
      for (let x = 0; x < 3; x++) {
        const nibble = parseInt(hash[(y * 3 + x) % hash.length], 16);
        if (nibble >= 7) {
          const tone: "signal" | "ink" = nibble >= 12 ? "signal" : "ink";
          out.push({ x, y, tone });
          if (x < 2) {
            out.push({ x: 4 - x, y, tone });
          }
        }
      }
    }
    if (out.length === 0) {
      out.push({ x: 2, y: 2, tone: "signal" });
    }
    return out;
  }, [address]);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 9 9"
      shapeRendering="crispEdges"
      aria-hidden="true"
      className={`shrink-0 rounded-2xl border border-line bg-well ${className}`}
    >
      {cells.map((c, idx) => (
        <rect
          key={idx}
          x={c.x + 2}
          y={c.y + 2}
          width={0.9}
          height={0.9}
          className={c.tone === "signal" ? "fill-signal" : "fill-ink"}
        />
      ))}
    </svg>
  );
}

/* ============================================================================
 * 7. MINIMAL CONTRACT HAIRLINE RIBBON
 * ========================================================================== */

export function ContractRibbon({ highlight }: { highlight?: string }) {
  const snippet = useMemo(() => `${PACKED_CODE.slice(0, 240)}${PACKED_CODE.slice(0, 240)}`, []);

  return (
    <div
      aria-hidden="true"
      className="num flex items-center gap-3 overflow-hidden border-y border-line py-2 text-[10.5px] font-medium tracking-tight text-stone-light"
    >
      {highlight && (
        <span className="shrink-0 font-bold text-signal">
          <CodeScramble value={highlight} />
        </span>
      )}
      <span className="truncate opacity-75">{snippet}</span>
    </div>
  );
}
