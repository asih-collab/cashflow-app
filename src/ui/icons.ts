// タブバーなどの線画アイコン（絵文字を使わない）
const svg = (body: string) => `<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;

export const ICONS = {
  home: svg('<path d="M4 11.5 12 5l8 6.5"/><path d="M6 10.5V19h12v-8.5"/>'),
  add: svg('<circle cx="12" cy="12" r="8.5"/><path d="M12 8.5v7M8.5 12h7"/>'),
  settings: svg('<path d="M4 7h10M18 7h2M4 17h4M12 17h8"/><circle cx="16" cy="7" r="2"/><circle cx="10" cy="17" r="2"/>'),
  back: svg('<path d="M14 6l-6 6 6 6"/>'),
  backspace: svg('<path d="M9 5h11a1 1 0 0 1 1 1v12a1 1 0 0 1-1 1H9l-6-7 6-7z"/><path d="M13 10l4 4M17 10l-4 4"/>'),
  trash: svg('<path d="M5 7h14M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>'),
  chevron: svg('<path d="M9 6l6 6-6 6"/>'),
};

export function icon(name: keyof typeof ICONS): HTMLElement {
  const span = document.createElement('span');
  span.className = 'ico';
  span.innerHTML = ICONS[name];
  return span;
}
