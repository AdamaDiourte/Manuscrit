export type MenuPlacement = "below" | "above";

export type MenuPos = {
  top?: number;
  bottom?: number;
  left: number;
  width: number;
  maxHeight: number;
  placement: MenuPlacement;
};

const EDGE = 10;
const MIN_H = 140;
const IDEAL_H = 280;

/** Place the menu in the viewport so every option stays reachable via inner scroll. */
export function computeMenuPos(trigger: DOMRect): MenuPos {
  const vw = window.innerWidth;
  const vh = window.innerHeight;
  const spaceBelow = vh - trigger.bottom - EDGE;
  const spaceAbove = trigger.top - EDGE;
  const placement: MenuPlacement =
    spaceBelow >= MIN_H || spaceBelow >= spaceAbove ? "below" : "above";
  const available = placement === "below" ? spaceBelow : spaceAbove;
  const maxHeight = Math.max(
    120,
    Math.min(IDEAL_H, Math.floor(available), Math.floor(vh * 0.55)),
  );
  const width = Math.min(Math.round(trigger.width), vw - EDGE * 2);
  const left = Math.min(
    Math.max(EDGE, Math.round(trigger.left)),
    Math.max(EDGE, vw - width - EDGE),
  );

  if (placement === "below") {
    return {
      top: Math.round(trigger.bottom) - 1,
      left,
      width,
      maxHeight,
      placement,
    };
  }

  return {
    bottom: Math.round(vh - trigger.top) - 1,
    left,
    width,
    maxHeight,
    placement,
  };
}
