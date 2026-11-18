import { useEffect, useId, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { computeMenuPos, type MenuPos } from "./menuPosition";
import { useMenuMotion } from "./useMenuMotion";

export type TopicSelectOption = { value: string; label: string };
export type TopicSelectGroup = {
  label: string;
  options: TopicSelectOption[];
};

type Props = {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  options?: TopicSelectOption[];
  groups?: TopicSelectGroup[];
  className?: string;
  compact?: boolean;
  allowEmpty?: boolean;
  disabled?: boolean;
  tabIndex?: number;
  "aria-label"?: string;
};

function flatOptions(
  options: TopicSelectOption[] | undefined,
  groups: TopicSelectGroup[] | undefined,
): TopicSelectOption[] {
  if (groups?.length) return groups.flatMap((g) => g.options);
  return options || [];
}

export default function TopicSelect({
  value,
  onChange,
  placeholder = "Choisir…",
  options,
  groups,
  className = "",
  compact = false,
  allowEmpty = true,
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
  const all = flatOptions(options, groups);
  const selected = all.find((o) => o.value === value);

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
  }, [open, mounted]);

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

  function choose(next: string) {
    onChange(next);
    setOpen(false);
  }

  const wrapClass = [
    "topic-select-wrap",
    open ? "is-open" : "",
    open && pos?.placement === "above" ? "is-above" : "",
    compact ? "is-compact" : "",
    className,
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
            aria-label={ariaLabel}
            style={{
              top: pos.top,
              bottom: pos.bottom,
              left: pos.left,
              width: pos.width,
              maxHeight: pos.maxHeight,
            }}
          >
            {allowEmpty ? (
              <button
                type="button"
                role="option"
                className={
                  value === ""
                    ? "topic-select-option is-selected"
                    : "topic-select-option"
                }
                aria-selected={value === ""}
                onClick={() => choose("")}
              >
                {placeholder}
              </button>
            ) : null}

            {groups?.length
              ? groups.map((group) => (
                  <div
                    key={group.label}
                    className="topic-select-group"
                    role="group"
                  >
                    <div className="topic-select-group-label">
                      {group.label}
                    </div>
                    {group.options.map((opt) => (
                      <button
                        key={opt.value}
                        type="button"
                        role="option"
                        className={
                          value === opt.value
                            ? "topic-select-option is-selected"
                            : "topic-select-option"
                        }
                        aria-selected={value === opt.value}
                        onClick={() => choose(opt.value)}
                      >
                        {opt.label}
                      </button>
                    ))}
                  </div>
                ))
              : (options || []).map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    role="option"
                    className={
                      value === opt.value
                        ? "topic-select-option is-selected"
                        : "topic-select-option"
                    }
                    aria-selected={value === opt.value}
                    onClick={() => choose(opt.value)}
                  >
                    {opt.label}
                  </button>
                ))}
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
            selected ? "topic-select-value" : "topic-select-placeholder"
          }
        >
          {selected ? selected.label : placeholder}
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
