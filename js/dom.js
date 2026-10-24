// dom.js - tiny helpers for building page elements safely.
// Text is always set with textContent, never innerHTML.

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

// For SVG elements, which need their own namespace.
export function svgEl(tag, attributes = {}) {
  const node = document.createElementNS("http://www.w3.org/2000/svg", tag);
  for (const [name, value] of Object.entries(attributes)) node.setAttribute(name, String(value));
  return node;
}

export function button(label, className, onClick) {
  const node = el("button", className, label);
  node.type = "button";
  if (onClick) node.addEventListener("click", onClick);
  return node;
}

export function link(label, href, className) {
  const node = el("a", className, label);
  node.href = href;
  return node;
}
