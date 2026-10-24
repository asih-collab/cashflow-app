// リボ・分割の残高の推移（折れ線）。「今のペース」と「月 +N 円返す場合」の 2 系列。
// 色は朱色（今のペース）と青（上乗せ）。暗い背景での明度帯・色覚の違いでの見分けを検査済み。
// 上乗せは破線にして、色だけに頼らない。凡例は上に、線の終わりに完済月を直接表示。
// 押す（なぞる）と縦線がその月に合い、2 系列の残高が上に出る。

import { yen } from '../lib/money';
import { niceCeil } from '../lib/stats';
import { monthLabel } from '../lib/debt';

const NS = 'http://www.w3.org/2000/svg';
const W = 340;
const H = 170;
const TOP = 26;
const BOTTOM = 20;
const RIGHT = 8;
const PLOT_H = H - TOP - BOTTOM;
const PLOT_W = W - RIGHT;

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

function text(x: number, y: number, s: string, cls: string, anchor = 'middle'): SVGTextElement {
  const t = el('text', { x, y, class: cls, 'text-anchor': anchor });
  t.textContent = s;
  return t;
}

export interface DebtSeries {
  name: string;
  cls: 'base' | 'extra';
  points: { month: string; balance: number }[];
}

export function renderDebtChart(series: DebtSeries[]): HTMLElement {
  const wrap = document.createElement('div');
  wrap.className = 'debt-chart-wrap';
  const all = series.flatMap((s) => s.points);
  if (all.length === 0) return wrap;
  const months = [...new Set(all.map((p) => p.month))].sort();
  const n = Math.max(1, months.length - 1);
  const top = niceCeil(Math.max(1, ...all.map((p) => p.balance)));
  const baseY = TOP + PLOT_H;
  const x = (m: string) => (months.indexOf(m) / n) * PLOT_W;
  const y = (v: number) => baseY - (v / top) * PLOT_H;

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'debt-chart', role: 'img', 'aria-label': series.map((s) => `${s.name}: ${s.points.at(-1)?.balance === 0 ? monthLabel(s.points.at(-1)!.month) + 'に完済' : '完済しない'}`).join('、') });
  svg.appendChild(el('line', { x1: 0, x2: PLOT_W, y1: TOP, y2: TOP, class: 'grid' }));
  svg.appendChild(el('line', { x1: 0, x2: PLOT_W, y1: baseY, y2: baseY, class: 'axis' }));
  svg.appendChild(text(0, TOP - 8, yen(top), 'tick', 'start'));
  svg.appendChild(text(0, H - 4, monthLabel(months[0]!), 'tick', 'start'));
  svg.appendChild(text(PLOT_W, H - 4, monthLabel(months.at(-1)!), 'tick', 'end'));

  for (const s of series) {
    if (s.points.length === 0) continue;
    const d = s.points.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.month).toFixed(1)},${y(p.balance).toFixed(1)}`).join(' ');
    svg.appendChild(el('path', { d, class: `line ${s.cls}` }));
    const last = s.points.at(-1)!;
    if (last.balance === 0) {
      svg.appendChild(el('circle', { cx: x(last.month), cy: y(0), r: 4, class: `end ${s.cls}` }));
    }
  }

  // なぞると縦線と値
  const cross = el('line', { x1: 0, x2: 0, y1: TOP, y2: baseY, class: 'cross', visibility: 'hidden' });
  svg.appendChild(cross);
  const dots = series.map((s) => { const c = el('circle', { r: 4, class: `dot ${s.cls}`, visibility: 'hidden' }); svg.appendChild(c); return c; });
  const hit = el('rect', { x: 0, y: 0, width: W, height: H, class: 'hit', tabindex: 0 });
  svg.appendChild(hit);

  const tip = document.createElement('div');
  tip.className = 'debt-tip';
  tip.hidden = true;

  const show = (m: string) => {
    const cx = x(m);
    cross.setAttribute('x1', String(cx));
    cross.setAttribute('x2', String(cx));
    cross.setAttribute('visibility', 'visible');
    tip.replaceChildren();
    const head = document.createElement('div');
    head.className = 'mono';
    head.textContent = monthLabel(m);
    tip.appendChild(head);
    series.forEach((s, i) => {
      const p = s.points.find((q) => q.month === m) ?? (s.points.at(-1) && s.points.at(-1)!.month < m && s.points.at(-1)!.balance === 0 ? { month: m, balance: 0 } : undefined);
      const dot = dots[i]!;
      if (!p) { dot.setAttribute('visibility', 'hidden'); return; }
      dot.setAttribute('cx', String(cx));
      dot.setAttribute('cy', String(y(p.balance)));
      dot.setAttribute('visibility', 'visible');
      const row = document.createElement('div');
      row.className = 'row';
      const key = document.createElement('span');
      key.className = `lkey ${s.cls}`;
      const v = document.createElement('b');
      v.textContent = yen(p.balance);
      const name = document.createElement('span');
      name.className = 'muted small';
      name.textContent = s.name;
      row.append(key, v, name);
      tip.appendChild(row);
    });
    tip.hidden = false;
    tip.style.left = `${Math.min(70, Math.max(0, (cx / W) * 100 - 15))}%`;
  };
  const hide = () => {
    cross.setAttribute('visibility', 'hidden');
    dots.forEach((d) => d.setAttribute('visibility', 'hidden'));
    tip.hidden = true;
  };
  const fromEvent = (e: PointerEvent) => {
    const r = svg.getBoundingClientRect();
    const px = ((e.clientX - r.left) / r.width) * W;
    const i = Math.max(0, Math.min(months.length - 1, Math.round((px / PLOT_W) * n)));
    show(months[i]!);
  };
  hit.addEventListener('pointermove', fromEvent);
  hit.addEventListener('pointerdown', fromEvent);
  hit.addEventListener('pointerleave', hide);
  let ki = 0;
  hit.addEventListener('focus', () => show(months[ki]!));
  hit.addEventListener('blur', hide);
  hit.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowRight') ki = Math.min(months.length - 1, ki + 1);
    else if (e.key === 'ArrowLeft') ki = Math.max(0, ki - 1);
    else return;
    e.preventDefault();
    show(months[ki]!);
  });

  // 凡例（線の見本）
  const legend = document.createElement('div');
  legend.className = 'debt-legend';
  for (const s of series) {
    const item = document.createElement('span');
    const key = document.createElement('span');
    key.className = `lkey ${s.cls}`;
    const last = s.points.at(-1);
    item.append(key, `${s.name}${last && last.balance === 0 ? ` → ${monthLabel(last.month)}` : ''}`);
    legend.appendChild(item);
  }
  wrap.append(legend, svg, tip);
  return wrap;
}
