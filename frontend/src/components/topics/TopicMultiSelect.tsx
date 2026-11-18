import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { TopicSelectOption } from "./TopicSelect";
import { computeMenuPos, type MenuPos } from "./menuPosition";
import { useMenuMotion } from "./useMenuMotion";

type Props = {
  value: string[];
  onChange: (value: string[]) => void;
  options: TopicSelectOption[];
  placeholder?: string;
  disabled?: boolean;
  tabIndex?: number;
  "aria-label"?: string;
};

export default function TopicMultiSelect({
  value,
  onChange,
  options,
  placeholder = "Choisir…",
  disabled = false,
  tabIndex,
  "aria-label": ariaLabel,
}: Props) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<MenuPos | null>(null);
  const { mounted, visible } = useMenuMotion(open);
  const rootRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const selected = options.filter((o) => value.includes(o.value));
  const summary =
    selected.length === 0
      ? placeholder
      : selected.length <= 2
        ? selected.map((o) => o.label).join(", ")
        : `${selected.length} sélection${selected.length > 1 ? "s" : ""}`;
  const hasSelection = selected.length > 0;

  function updatePos() {
    const el = rootRef.current;
    if (!el) return;
    setPos(computeMenuPos(el.getBoundingClientRect()));
  }

  useLayoutEffect(() => {
    if (!open && !mounted) {
      setPos(null);
      return;
    }
    if (open || mounted) updatePos();
  }, [open, mounted, value.length]);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      const t = e.target as Node;
      if (rootRef.current?.contains(t) || menuRef.current?.contains(t)) return;
      setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    function onReposition() {
      updatePos();
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", onReposition);
    window.addEventListener("scroll", onReposition, true);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", onReposition);
      window.removeEventListener("scroll", onReposition, true);
    };
  }, [open]);

  function toggle(optValue: string) {
    if (value.includes(optValue)) {
      onChange(value.filter((v) => v !== optValue));
    } else {
      onChange([...value, optValue]);
    }
  }

  const wrapClass = [
    "topic-select-wrap",
    "topic-multi-select",
    open ? "is-open" : "",
    open && pos?.placement === "above" ? "is-above" : "",
    hasSelection ? "has-selection" : "",
  ]
    .filter(Boolean)
    .join(" ");

  const menu =
    mounted && pos
      ? createPortal(
          <div
            ref={menuRef}
            id={listId}
            className={[
              "topic-select-menu",
              visible ? "is-visible" : "",
              pos.placement === "above" ? "is-above" : "",
            ]
              .filter(Boolean)
              .join(" ")}
            role="listbox"
            aria-multiselectable="true"
            aria-label={ariaLabel}
            style={{
              top: pos.top,
              bottom: pos.bottom,
              left: pos.left,
              width: pos.width,
              maxHeight: pos.maxHeight,
            }}
          >
            {options.map((opt) => {
              const checked = value.includes(opt.value);
              return (
                <label
                  key={opt.value}
                  className={
                    checked
                      ? "topic-select-option topic-multi-option is-selected"
                      : "topic-select-option topic-multi-option"
                  }
                >
                  <input
                    type="checkbox"
                    checked={checked}
                    onChange={() => toggle(opt.value)}
                  />
                  <span>{opt.label}</span>
                </label>
              );
            })}
          </div>,
          document.body,
        )
      : null;

  return (
    <div ref={rootRef} className={wrapClass}>
      <button
        type="button"
        className="topic-select"
        aria-label={ariaLabel}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={listId}
        disabled={disabled}
        tabIndex={tabIndex}
        onClick={() => {
          setOpen((v) => {
            if (!v) {
              rootRef.current?.scrollIntoView({
                block: "nearest",
                behavior: "smooth",
              });
            }
            return !v;
          });
        }}
      >
        <span
          className={
            hasSelection
              ? "topic-select-value topic-multi-summary"
              : "topic-select-placeholder"
          }
        >
          {hasSelection && selected.length > 2 ? (
            <>
              <em className="topic-multi-count">{selected.length}</em>
              {" sélection"}
              {selected.length > 1 ? "s" : ""}
            </>
          ) : (
            summary
          )}
        </span>
        <i
          className="fa-solid fa-chevron-down topic-select-chevron"
          aria-hidden="true"
        />
      </button>
      {menu}
    </div>
  );
}
