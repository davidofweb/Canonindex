import { useEffect, type ReactNode } from "react";
import { X } from "lucide-react";

export function BottomSheet({
  open,
  onClose,
  title,
  subtitle,
  children,
  maxWidthClass = "lg:max-w-lg",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  children: ReactNode;
  maxWidthClass?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);

    return () => {
      document.body.style.overflow = prevOverflow;
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center lg:items-center lg:p-6"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <button
        type="button"
        aria-label="Close panel"
        onClick={onClose}
        className="animate-backdrop fixed inset-0 h-full w-full cursor-default bg-black/55 backdrop-blur-[3px]"
      />

      <div
        className={`animate-sheet oxygen-glass-sheet relative z-10 flex max-h-[88dvh] w-full flex-col overflow-hidden rounded-t-[28px] text-ink lg:max-h-[85dvh] lg:rounded-[26px] ${maxWidthClass}`}
      >
        <div className="flex justify-center pt-2.5 pb-1 lg:hidden" aria-hidden="true">
          <span className="h-1 w-9 rounded-full bg-line-strong" />
        </div>

        <div className="flex items-start justify-between gap-4 px-5 pt-2.5 pb-4 lg:px-6 lg:pt-5">
          <div className="min-w-0">
            <h2 className="heading-card text-[20px] text-ink lg:text-[21px]">{title}</h2>
            {subtitle && (
              <p className="mt-1 text-[13px] leading-snug text-stone">{subtitle}</p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="inline-flex h-10 w-10 shrink-0 cursor-pointer items-center justify-center rounded-full bg-well text-ink transition-colors hover:bg-well-hover"
          >
            <X className="h-4.5 w-4.5 stroke-[2.25]" />
          </button>
        </div>

        <div className="overflow-y-auto overscroll-contain px-5 pt-5 pb-[calc(1.5rem+env(safe-area-inset-bottom,0px))] lg:px-6 lg:pb-6">
          {children}
        </div>
      </div>
    </div>
  );
}
