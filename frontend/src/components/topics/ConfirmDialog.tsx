import { useCallback, useEffect, useId, useState } from "react";

type ConfirmOptions = {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
};

type Pending = ConfirmOptions & {
  resolve: (value: boolean) => void;
};

type DialogProps = {
  open: boolean;
  title: string;
  message: string;
  confirmLabel: string;
  cancelLabel: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
};

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel,
  cancelLabel,
  danger,
  onConfirm,
  onCancel,
}: DialogProps) {
  const titleId = useId();

  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  if (!open) return null;

  return (
    <div
      className="overlay topic-confirm-overlay"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div
        className="dialog topic-confirm"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="dialoghead">
          <h2 id={titleId}>{title}</h2>
        </div>
        <p className="topic-confirm-msg">{message}</p>
        <div className="topic-confirm-actions">
          <button type="button" className="secondary" onClick={onCancel}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={danger ? "primary topic-confirm-danger" : "primary"}
            onClick={onConfirm}
            autoFocus
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Promise-based confirm dialog matching Manuscrit UI. */
export function useConfirmDialog() {
  const [pending, setPending] = useState<Pending | null>(null);

  const confirm = useCallback((options: ConfirmOptions) => {
    return new Promise<boolean>((resolve) => {
      setPending({ ...options, resolve });
    });
  }, []);

  const close = useCallback((value: boolean) => {
    setPending((current) => {
      current?.resolve(value);
      return null;
    });
  }, []);

  const dialog = (
    <ConfirmDialog
      open={!!pending}
      title={pending?.title || "Confirmation"}
      message={pending?.message || ""}
      confirmLabel={pending?.confirmLabel || "Confirmer"}
      cancelLabel={pending?.cancelLabel || "Annuler"}
      danger={pending?.danger}
      onConfirm={() => close(true)}
      onCancel={() => close(false)}
    />
  );

  return { confirm, dialog };
}
