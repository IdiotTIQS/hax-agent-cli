export function getFocusableElements(container) {
  if (!container) return [];
  return container.querySelectorAll(
    'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
  );
}

export function trapTab(e, getElements) {
  if (typeof document === 'undefined') return;
  if (e.key !== 'Tab') return;
  const els = getElements();
  if (els.length === 0) { e.preventDefault(); return; }
  const first = els[0];
  const last = els[els.length - 1];
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}
