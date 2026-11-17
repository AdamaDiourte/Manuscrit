import { useEffect, useRef, useState, type ReactNode } from "react";

type Props = {
  show: boolean;
  children: ReactNode;
  /** Exit duration in ms — keep in sync with CSS. */
  durationMs?: number;
  className?: string;
};

/**
 * Mounts children on show, keeps them during exit so CSS can animate close.
 */
export default function AnimatedReveal({
  show,
  children,
  durationMs = 280,
  className = "",
}: Props) {
  const [mounted, setMounted] = useState(show);
  const [open, setOpen] = useState(show);
  const timer = useRef<number | null>(null);

  useEffect(() => {
    if (timer.current) {
      window.clearTimeout(timer.current);
      timer.current = null;
    }

    if (show) {
      setMounted(true);
      const id = window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => setOpen(true));
      });
      return () => window.cancelAnimationFrame(id);
    }

    setOpen(false);
    timer.current = window.setTimeout(() => {
      setMounted(false);
      timer.current = null;
    }, durationMs);

    return () => {
      if (timer.current) window.clearTimeout(timer.current);
    };
  }, [show, durationMs]);

  if (!mounted) return null;

  return (
    <div
      className={
        "topic-reveal" +
        (open ? " is-open" : " is-closing") +
        (className ? " " + className : "")
      }
      aria-hidden={!open}
    >
      {children}
    </div>
  );
}
