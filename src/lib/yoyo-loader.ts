import { useEffect, useSyncExternalStore } from "react";

export type VerifyPosture = "idle" | "scan" | "sign" | "confirm" | "alert";

export type BootState = {
  active: boolean;
  ready: boolean;
  exiting: boolean;
  progress: number;
  label: string;
  detail: string;
};

export type VerifyState = {
  active: boolean;
  posture: VerifyPosture;
  address?: string;
  label: string;
  sublabel?: string;
};

type StoreSnapshot = {
  boot: BootState;
  verify: VerifyState;
  inlineStageCount: number;
  idle: boolean;
};

let snapshot: StoreSnapshot = {
  boot: {
    active: true,
    ready: false,
    exiting: false,
    progress: 0.18,
    label: "Waking Vault",
    detail: "Elysium 99801 · Connecting live index",
  },
  verify: {
    active: false,
    posture: "idle",
    label: "",
  },
  inlineStageCount: 0,
  idle: false,
};

const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

let bootExitTimer: number | null = null;
let verifyDismissTimer: number | null = null;

export function updateBootProgress(patch: Partial<Pick<BootState, "progress" | "label" | "detail" | "ready">>) {
  if (!snapshot.boot.active) return;
  snapshot = {
    ...snapshot,
    boot: {
      ...snapshot.boot,
      ...patch,
    },
  };
  emit();
}

export function completeBootSequence() {
  if (!snapshot.boot.active || snapshot.boot.exiting) return;
  snapshot = {
    ...snapshot,
    boot: {
      ...snapshot.boot,
      ready: true,
      exiting: true,
      progress: 1,
      label: "Vault Ready",
      detail: "Elysium 99801 · Live",
    },
  };
  emit();

  if (typeof window !== "undefined") {
    if (bootExitTimer) window.clearTimeout(bootExitTimer);
    bootExitTimer = window.setTimeout(() => {
      snapshot = {
        ...snapshot,
        boot: {
          ...snapshot.boot,
          active: false,
          exiting: false,
        },
      };
      emit();
    }, 340);
  }
}

export function startAddressVerify(opts: {
  posture?: VerifyPosture;
  address?: string;
  label: string;
  sublabel?: string;
}) {
  if (typeof window !== "undefined" && verifyDismissTimer) {
    window.clearTimeout(verifyDismissTimer);
    verifyDismissTimer = null;
  }
  snapshot = {
    ...snapshot,
    verify: {
      active: true,
      posture: opts.posture ?? "scan",
      address: opts.address,
      label: opts.label,
      sublabel: opts.sublabel,
    },
  };
  emit();
}

export function finishAddressVerify(opts: {
  ok: boolean;
  address?: string;
  label: string;
  sublabel?: string;
  holdMs?: number;
}) {
  if (typeof window !== "undefined" && verifyDismissTimer) {
    window.clearTimeout(verifyDismissTimer);
    verifyDismissTimer = null;
  }
  snapshot = {
    ...snapshot,
    verify: {
      active: true,
      posture: opts.ok ? "confirm" : "alert",
      address: opts.address ?? snapshot.verify.address,
      label: opts.label,
      sublabel: opts.sublabel,
    },
  };
  emit();

  if (typeof window !== "undefined") {
    verifyDismissTimer = window.setTimeout(() => {
      snapshot = {
        ...snapshot,
        verify: {
          ...snapshot.verify,
          active: false,
          posture: "idle",
        },
      };
      emit();
    }, opts.holdMs ?? 1050);
  }
}

export function dismissAddressVerify() {
  if (typeof window !== "undefined" && verifyDismissTimer) {
    window.clearTimeout(verifyDismissTimer);
    verifyDismissTimer = null;
  }
  if (!snapshot.verify.active) return;
  snapshot = {
    ...snapshot,
    verify: {
      ...snapshot.verify,
      active: false,
      posture: "idle",
    },
  };
  emit();
}

export function useRegisterInlineVerifyStage(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;
    snapshot = {
      ...snapshot,
      inlineStageCount: snapshot.inlineStageCount + 1,
    };
    emit();
    return () => {
      snapshot = {
        ...snapshot,
        inlineStageCount: Math.max(0, snapshot.inlineStageCount - 1),
      };
      emit();
    };
  }, [enabled]);
}

export function setScreenIdle(idle: boolean) {
  if (snapshot.idle === idle) return;
  snapshot = {
    ...snapshot,
    idle,
  };
  emit();
}

export function useYoyoLoader(): StoreSnapshot {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => snapshot,
  );
}
