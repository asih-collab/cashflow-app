// 日別の変動費（縦棒グラフ）。1 系列なので凡例は付けず、見出しが何を描いているかを示す。
// 色は朱色 1 色（暗い背景での明度帯・コントラストを検査済み）。最大の日だけ金額を直接表示し、
// 平均は細い実線の参照線。棒を押すとその日の明細が下に出る（ツールチップの代わり）。

import { yen } from '../lib/money';
import { niceCeil, type DailyTotal } from '../lib/stats';

const NS = 'http://www.w3.org/2000/svg';
const W = 340;
const H = 150;
const TOP = 22; // 最大値ラベルの余白
const BOTTOM = 20; // 日付ラベルの余白
const PLOT_H = H - TOP - BOTTOM;

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

/** 上が丸く（最大 4px）、下（基準線）は四角い棒のパス */
function barPath(x: number, w: number, y0: number, h: number): string {
  const r = Math.min(4, w / 2, h);
  const top = y0 - h;
  return `M${x},${y0} V${top + r} Q${x},${top} ${x + r},${top} H${x + w - r} Q${x + w},${top} ${x + w},${top + r} V${y0} Z`;
}

export interface DailyChartOptions {
  days: DailyTotal[];
  today: string;
  selected: string | null;
  onSelect: (date: string) => void;
}

export function renderDailyChart(o: DailyChartOptions): SVGSVGElement {
  const { days, today } = o;
  const n = days.length;
  const slot = W / n;
  const barW = Math.max(3, Math.min(24, slot - 2)); // 棒同士の間に 2px 以上の隙間
  const past = days.filter((d) => d.date <= today);
  const max = Math.max(0, ...days.map((d) => d.amount));
  const top = niceCeil(max);
  const baseY = TOP + PLOT_H;
  const scale = (v: number) => (v / top) * PLOT_H;
  const avg = past.length > 0 ? Math.round(past.reduce((s, d) => s + d.amount, 0) / past.length) : 0;

  const svg = el('svg', { viewBox: `0 0 ${W} ${H}`, class: 'daily-chart', role: 'img', 'aria-label': `日別の変動費。最大 ${yen(max)}、1 日平均 ${yen(avg)}` });

  // 目盛り: 基準線と上端の 2 本だけ（控えめな細い実線）
  svg.appendChild(el('line', { x1: 0, x2: W, y1: TOP, y2: TOP, class: 'grid' }));
  svg.appendChild(el('line', { x1: 0, x2: W, y1: baseY, y2: baseY, class: 'axis' }));
  svg.appendChild(text(0, TOP - 6, yen(top), 'tick', 'start'));

  // 棒
  days.forEach((d, i) => {
    const x = i * slot + (slot - barW) / 2;
    const isFuture = d.date > today;
    if (d.amount > 0) {
      const p = el('path', { d: barPath(x, barW, baseY, Math.max(2, scale(d.amount))), class: 'bar' + (d.date === o.selected ? ' on' : '') });
      svg.appendChild(p);
    } else if (!isFuture) {
      svg.appendChild(el('rect', { x: x + barW / 2 - 1, y: baseY - 2, width: 2, height: 2, class: 'zero' }));
    }
  });

  // 平均の参照線（記録がある場合だけ）
  if (avg > 0) {
    const y = baseY - scale(avg);
    svg.appendChild(el('line', { x1: 0, x2: W, y1: y, y2: y, class: 'avg' }));
    // ラベルは棒に重ならないよう、グラフの上（右端）に置き、短い線で凡例にする
    const label = text(W, TOP - 6, `AVG ${yen(avg)}`, 'tick avg-label', 'end');
    svg.appendChild(label);
    svg.appendChild(el('line', { x1: W - 92, x2: W - 80, y1: TOP - 9, y2: TOP - 9, class: 'avg' }));
  }

  // 最大の日だけ金額を直接表示
  if (max > 0) {
    const i = days.findIndex((d) => d.amount === max);
    const cx = i * slot + slot / 2;
    const anchor = cx < 30 ? 'start' : cx > W - 30 ? 'end' : 'middle';
    svg.appendChild(text(cx, baseY - scale(max) - 5, yen(max), 'peak', anchor));
  }

  // 日付ラベル: 1 日と 5 日おき、今日
  days.forEach((d, i) => {
    const day = Number(d.date.slice(8));
    const cx = i * slot + slot / 2;
    if (d.date === today) svg.appendChild(text(cx, H - 4, '今日', 'tick today'));
    else if ((i === 0 || day % 5 === 0) && Math.abs(days.findIndex((x) => x.date === today) - i) > 1) svg.appendChild(text(cx, H - 4, String(day), 'tick'));
  });

  // 押せる範囲（棒より広い、列全体）
  days.forEach((d, i) => {
    if (d.date > today) return;
    const hit = el('rect', {
      x: i * slot, y: 0, width: slot, height: H, class: 'hit', tabindex: 0,
      'data-date': d.date, 'data-testid': `day-${d.date}`, role: 'button',
      'aria-label': `${Number(d.date.slice(5, 7))}月${Number(d.date.slice(8))}日 ${yen(d.amount)}、${d.count} 件`,
    });
    hit.addEventListener('click', () => o.onSelect(d.date));
    hit.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter' || (e as KeyboardEvent).key === ' ') { e.preventDefault(); o.onSelect(d.date); } });
    svg.appendChild(hit);
  });

  return svg;
}
