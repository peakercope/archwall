import { el } from "@/shared/lib/dom";
import type { User } from "../model/user";

export function UserAvatar({ user }: { user: User }): HTMLSpanElement {
  const initials = user.name
    .split(" ")
    .map((part) => part[0] ?? "")
    .join("");

  return el("span", {
    className: "avatar",
    title: user.name,
    textContent: initials,
  });
}
