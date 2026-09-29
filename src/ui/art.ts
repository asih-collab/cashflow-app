// シックなアートワーク（SVG）。写真の代わりに、色面と粒子（グレイン）で落ち着いた画像を生成する。
// 外部の画像サービスに頼らず、オフラインでも同じ絵が出る。

export type ArtVariant = 'dusk' | 'moss' | 'ink' | 'ember';

const PALETTES: Record<ArtVariant, { base: string; a: string; b: string; c: string }> = {
  dusk: { base: '#1E2430', a: '#B9673F', b: '#E7C39A', c: '#3E5A6E' },
  moss: { base: '#1C2E28', a: '#5E8C6A', b: '#D9C89B', c: '#284A3E' },
  ink: { base: '#141519', a: '#4B4E5C', b: '#A79C86', c: '#2A2D38' },
  ember: { base: '#0A0A0B', a: '#FF5B24', b: '#7A2A12', c: '#1C1C20' },
};

/** 疑似乱数（同じ seed なら同じ絵） */
function rng(seed: number): () => number {
  let s = seed >>> 0 || 1;
  return () => {
    s ^= s << 13; s >>>= 0; s ^= s >>> 17; s ^= s << 5; s >>>= 0;
    return (s % 10000) / 10000;
  };
}

export function artworkSvg(variant: ArtVariant = 'dusk', seed = 7, w = 400, h = 220): string {
  const p = PALETTES[variant];
  const r = rng(seed);
  const id = `art${variant}${seed}`;
  const blobs = Array.from({ length: 4 }, (_, i) => {
    const cx = Math.round(w * (0.15 + r() * 0.7));
    const cy = Math.round(h * (0.2 + r() * 0.7));
    const rad = Math.round(Math.min(w, h) * (0.35 + r() * 0.45));
    const col = [p.a, p.b, p.c, p.a][i]!;
    const op = 0.55 + r() * 0.3;
    return `<circle cx="${cx}" cy="${cy}" r="${rad}" fill="url(#${id}g${i})" opacity="${op.toFixed(2)}"/>
      <radialGradient id="${id}g${i}"><stop offset="0" stop-color="${col}" stop-opacity="0.95"/><stop offset="1" stop-color="${col}" stop-opacity="0"/></radialGradient>`;
  }).join('');
  const orbits = Array.from({ length: 3 }, () => {
    const cx = Math.round(w * (0.3 + r() * 0.4));
    const cy = Math.round(h * (0.3 + r() * 0.5));
    const rx = Math.round(w * (0.25 + r() * 0.4));
    const ry = Math.round(rx * (0.35 + r() * 0.4));
    const rot = Math.round(r() * 60 - 30);
    return `<ellipse cx="${cx}" cy="${cy}" rx="${rx}" ry="${ry}" transform="rotate(${rot} ${cx} ${cy})" fill="none" stroke="#fff" stroke-opacity="0.16" stroke-width="0.8"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
  <defs>
    <filter id="${id}n" x="0" y="0" width="100%" height="100%"><feTurbulence type="fractalNoise" baseFrequency="0.9" numOctaves="2" stitchTiles="stitch"/><feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 0 0.18 0"/></filter>
    <linearGradient id="${id}v" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#000" stop-opacity="0"/><stop offset="1" stop-color="#000" stop-opacity="0.35"/></linearGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="${p.base}"/>
  ${blobs}
  ${orbits}
  <rect width="${w}" height="${h}" fill="url(#${id}v)"/>
  <rect width="${w}" height="${h}" filter="url(#${id}n)" opacity="0.5"/>
</svg>`;
}

export function artworkElement(variant: ArtVariant = 'dusk', seed = 7): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'art';
  wrap.innerHTML = artworkSvg(variant, seed);
  return wrap;
}
