import { el } from "../lib/dom";

interface ButtonOptions {
  readonly label: string;
  readonly variant?: "primary" | "ghost";
  readonly type?: HTMLButtonElement["type"];
  readonly onClick?: () => void;
}

export function Button({
  label,
  variant = "primary",
  type = "button",
  onClick,
}: ButtonOptions): HTMLButtonElement {
  return el("button", {
    className: `button button--${variant}`,
    type,
    textContent: label,
    onclick: onClick ? () => onClick() : null,
  });
}

// ─── ArchWall demo 2: `shared` importing a feature ──────────────────────────
// Select the two lines below and toggle the comment (Cmd+/ or Ctrl+/).
//
// Fires TWO rules:
//   layer-dependencies — `shared` is the lowest layer and may not import upward.
//   no-cycles          — features/create-task already imports this Button, so the
//                        upward import closes a loop. Upward dependencies almost
//                        always create cycles; that is what layering prevents.
//
// import { createTask } from "@/features/create-task";
// export const QuickAdd = () => Button({ label: "Quick add", onClick: () => createTask("Quick task") });
