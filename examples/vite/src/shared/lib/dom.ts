type Child = Node | string | null | undefined | false;

/**
 * Minimal `document.createElement` wrapper: props are assigned as *properties*, so
 * `className`, `ariaLabel`, `checked` and `onclick` are all type-checked against the
 * element the tag produces. No framework, no virtual DOM — a UI function here just
 * returns a real node.
 */
export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  props: Partial<HTMLElementTagNameMap[K]> = {},
  ...children: Child[]
): HTMLElementTagNameMap[K] {
  const node = Object.assign(document.createElement(tag), props);
  for (const child of children) {
    if (child !== null && child !== undefined && child !== false) node.append(child);
  }
  return node;
}
