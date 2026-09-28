export function uuid(): string {
  const c = globalThis.crypto as Crypto | undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  const b = new Uint8Array(16);
  if (c) c.getRandomValues(b);
  else for (let i = 0; i < 16; i++) b[i] = Math.floor(Math.random() * 256);
  b[6] = (b[6]! & 0x0f) | 0x40;
  b[8] = (b[8]! & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

let lastMs = 0;

/** 現在時刻の ISO 文字列。同じミリ秒に 2 回呼ばれても必ず増える（updated_at の比較で同時刻にならないように） */
export function nowIso(): string {
  let ms = Date.now();
  if (ms <= lastMs) ms = lastMs + 1;
  lastMs = ms;
  return new Date(ms).toISOString();
}
