const ATTR = 'data-m14u-highlight';

function createOverlay(rect: DOMRect, label?: string): HTMLDivElement {
  const el = document.createElement('div');
  el.setAttribute(ATTR, '');
  Object.assign(el.style, {
    position: 'fixed', top: `${rect.top}px`, left: `${rect.left}px`,
    width: `${rect.width}px`, height: `${rect.height}px`,
    border: '3px solid #ff3b6b', borderRadius: '6px',
    background: 'rgba(255,59,107,0.12)', pointerEvents: 'none', zIndex: '99999',
    transition: 'opacity 0.3s',
  });
  if (label) {
    const tag = document.createElement('span');
    Object.assign(tag.style, {
      position: 'absolute', top: '-22px', left: '0', background: '#ff3b6b',
      color: '#fff', fontSize: '11px', padding: '2px 6px', borderRadius: '3px',
      whiteSpace: 'nowrap', fontFamily: 'monospace',
    });
    tag.textContent = label;
    el.appendChild(tag);
  }
  document.body.appendChild(el);
  setTimeout(() => { el.style.opacity = '0'; setTimeout(() => el.remove(), 300); }, 3000);
  return el;
}

export function highlight(selector: string, label?: string) {
  const target = document.querySelector(selector);
  if (!target) throw new Error(`highlight: no element matches "${selector}"`);
  createOverlay(target.getBoundingClientRect(), label);
}

export function highlightButton(text: string) {
  const buttons = Array.from(document.querySelectorAll('button'));
  const btn = buttons.find(b => b.textContent?.includes(text));
  if (!btn) throw new Error(`highlightButton: no button with text "${text}"`);
  createOverlay(btn.getBoundingClientRect(), text);
}

export function clearHighlights() {
  document.querySelectorAll(`[${ATTR}]`).forEach(el => el.remove());
}
