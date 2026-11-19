/** Tiny DOM helpers — the UI is plain DOM + the observable store, no framework. */

type Child = Node | string | null | undefined | false;

export interface Props {
  class?: string;
  text?: string;
  html?: string;
  title?: string;
  hidden?: boolean;
  disabled?: boolean;
  onClick?: (ev: MouseEvent) => void;
  attrs?: Record<string, string>;
}

/** Create an element. */
export function el<K extends keyof HTMLElementTagNameMap>(tag: K, props: Props = {}, children: Child[] = []): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (props.class) node.className = props.class;
  if (props.text !== undefined) node.textContent = props.text;
  if (props.html !== undefined) node.innerHTML = props.html;
  if (props.title) {
    node.title = props.title;
    node.setAttribute('aria-label', props.title);
  }
  if (props.hidden) node.hidden = true;
  if (props.disabled) (node as unknown as HTMLButtonElement).disabled = true;
  if (props.onClick) node.addEventListener('click', props.onClick as EventListener);
  if (props.attrs) for (const [k, v] of Object.entries(props.attrs)) node.setAttribute(k, v);
  for (const c of children) if (c) node.append(c);
  return node;
}

/** Replace all children of a node. */
export function setChildren(node: HTMLElement, children: Child[]): void {
  node.replaceChildren(...(children.filter(Boolean) as Array<Node | string>));
}

/** Toggle a class. */
export function cls(node: HTMLElement, name: string, on: boolean): void {
  node.classList.toggle(name, on);
}

/** Escape text for safe use inside innerHTML templates. */
export function esc(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!);
}
