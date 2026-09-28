import { h } from './dom';

export interface ToastOptions {
  actionLabel?: string;
  onAction?: () => void;
  durationMs?: number;
}

export function toast(message: string, opts: ToastOptions = {}): () => void {
  const root = document.getElementById('toast-root');
  if (!root) return () => {};
  let closed = false;
  const el = h('div', { class: 'toast', role: 'status', 'data-testid': 'toast' }, h('span', null, message));
  const close = () => {
    if (closed) return;
    closed = true;
    el.remove();
  };
  if (opts.actionLabel) {
    el.appendChild(
      h('button', { type: 'button', onClick: () => { opts.onAction?.(); close(); } }, opts.actionLabel),
    );
  }
  root.appendChild(el);
  setTimeout(close, opts.durationMs ?? 3500);
  return close;
}
