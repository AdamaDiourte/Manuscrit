import { useEffect, useState } from "react";

/** Keep in sync with `.topic-select-menu` CSS transition. */
export const MENU_MOTION_MS = 200;

/** Mounts the menu for exit animation after `open` becomes false. */
export function useMenuMotion(open: boolean) {
  const [mounted, setMounted] = useState(open);
  const [visible, setVisible] = useState(open);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const id = window.requestAnimationFrame(() => {
        window.requestAnimationFrame(() => setVisible(true));
      });
      return () => window.cancelAnimationFrame(id);
    }
    setVisible(false);
    const timer = window.setTimeout(() => setMounted(false), MENU_MOTION_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  return { mounted, visible };
}
