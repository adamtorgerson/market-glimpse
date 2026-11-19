/**
 * Dropdowns drawn by the page instead of the WebView's native popup.
 *
 * On Android a `<select>` list is a native popup that the host app (the Even
 * app) opens for the WebView. When the Even app's native layer wedges, those
 * popups stop opening (along with its back button), while the page itself
 * keeps working. So each `<select>` stays in the DOM, hidden, as the model the
 * rest of the code reads and writes, and a button and an in-page list stand in
 * for it on screen.
 *
 * The button follows the select: options added, removed, renamed or disabled,
 * the select disabled, and `value` / `selectedIndex` set from code. Picking an
 * option sets the select and fires `input` and `change` on it, as a native pick
 * does.
 */

const proto = HTMLSelectElement.prototype;
const valueProp = Object.getOwnPropertyDescriptor(proto, 'value')!;
const indexProp = Object.getOwnPropertyDescriptor(proto, 'selectedIndex')!;

let closeOpen: (() => void) | null = null;

/** Replace every `<select>` under `root` on screen with a page-drawn dropdown. */
export function enhanceSelects(root: ParentNode = document): void {
  for (const sel of root.querySelectorAll('select')) enhanceSelect(sel);
}

export function enhanceSelect(sel: HTMLSelectElement): void {
  if (sel.dataset.enhanced) return;
  sel.dataset.enhanced = '1';

  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'dropdown';
  if (sel.id) button.id = `${sel.id}-button`;
  button.setAttribute('aria-haspopup', 'listbox');
  button.setAttribute('aria-expanded', 'false');
  const ariaLabel = sel.getAttribute('aria-label');
  if (ariaLabel) button.setAttribute('aria-label', ariaLabel);
  const text = document.createElement('span');
  text.className = 'dropdown-text';
  const caret = document.createElement('span');
  caret.className = 'dropdown-caret';
  caret.setAttribute('aria-hidden', 'true');
  caret.textContent = '▾';
  button.append(text, caret);
  // Before the select, so a wrapping <label> activates the button.
  sel.before(button);
  sel.hidden = true;

  const refresh = () => {
    text.textContent = sel.selectedOptions[0]?.text ?? '';
    button.disabled = sel.disabled;
  };
  refresh();
  new MutationObserver(refresh).observe(sel, { childList: true, subtree: true, attributes: true, characterData: true });
  // Setting `value` from code changes no attribute, so the observer wouldn't see it.
  Object.defineProperty(sel, 'value', {
    configurable: true,
    get() { return valueProp.get!.call(this); },
    set(v: string) { valueProp.set!.call(this, v); refresh(); },
  });
  Object.defineProperty(sel, 'selectedIndex', {
    configurable: true,
    get() { return indexProp.get!.call(this); },
    set(v: number) { indexProp.set!.call(this, v); refresh(); },
  });
  sel.addEventListener('change', refresh);

  button.addEventListener('click', (e) => {
    // A label around the button would otherwise pass the click on again.
    e.preventDefault();
    if (!sel.disabled) open(sel, button, refresh);
  });
}

function open(sel: HTMLSelectElement, button: HTMLButtonElement, refresh: () => void): void {
  closeOpen?.();
  const backdrop = document.createElement('div');
  backdrop.className = 'dropdown-backdrop';
  const list = document.createElement('div');
  list.className = 'dropdown-list';
  list.setAttribute('role', 'listbox');
  const title = button.closest('label')?.firstChild?.textContent?.trim() || sel.getAttribute('aria-label') || '';
  if (title) list.setAttribute('aria-label', title);

  let current: HTMLButtonElement | null = null;
  const addOption = (opt: HTMLOptionElement) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'dropdown-option';
    item.setAttribute('role', 'option');
    item.textContent = opt.text;
    item.disabled = opt.disabled;
    const selected = opt.selected;
    item.setAttribute('aria-selected', String(selected));
    if (selected) current = item;
    item.addEventListener('click', () => {
      close();
      if (opt.selected) return;
      sel.value = opt.value;
      refresh();
      sel.dispatchEvent(new Event('input', { bubbles: true }));
      sel.dispatchEvent(new Event('change', { bubbles: true }));
    });
    list.append(item);
  };
  for (const child of sel.children) {
    if (child instanceof HTMLOptGroupElement) {
      const head = document.createElement('div');
      head.className = 'dropdown-group';
      head.textContent = child.label;
      list.append(head);
      for (const opt of child.querySelectorAll('option')) addOption(opt);
    } else if (child instanceof HTMLOptionElement) {
      addOption(child);
    }
  }

  const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') close(); };
  const close = () => {
    if (closeOpen !== close) return;
    closeOpen = null;
    backdrop.remove();
    document.removeEventListener('keydown', onKey);
    document.body.classList.remove('dropdown-open');
    button.setAttribute('aria-expanded', 'false');
  };
  closeOpen = close;
  backdrop.addEventListener('click', (e) => { if (e.target === backdrop) close(); });
  document.addEventListener('keydown', onKey);

  backdrop.append(list);
  document.body.append(backdrop);
  document.body.classList.add('dropdown-open');
  button.setAttribute('aria-expanded', 'true');
  (current as HTMLButtonElement | null)?.scrollIntoView({ block: 'center' });
}
