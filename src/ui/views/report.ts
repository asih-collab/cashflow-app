// 月終わりのふり返りと来月の見通し。その人の記録だけから、この端末の中で計算する（lib/monthlyReport.ts）
import { h } from '../dom';
import { yen } from '../../lib/money';
import { monthLabel } from '../../lib/debt';
import type { AppContext } from '../context';
import { icon } from '../icons';
import { toast } from '../toast';
import { renderItems } from '../adviceList';

const signed = (v: number) => `${v > 0 ? '+' : v < 0 ? '−' : ''}${yen(Math.abs(v))}`;

export function renderReport(ctx: AppContext): HTMLElement {
  const { store } = ctx;
  const r = store.monthlyReport();
  const root = h('div', { 'data-testid': 'report' },
    h('div', { class: 'row' }, h('a', { href: '#/summary', style: 'display:inline-flex', 'aria-label': '戻る' }, icon('back')), h('h1', { class: 'grow', style: 'margin:0 0 0 8px' }, 'ふり返りと見通し')),
  );
  if (!r) {
    root.appendChild(h('div', { class: 'card muted small' }, '予算期間が 1 回終わると、ここにふり返りと来月の見通しが出ます。'));
    return root;
  }
  void store.markReportSeen(r.period.start);

  // ふり返り
  root.appendChild(h('h2', null, `${r.period.label}のふり返り`));
  root.appendChild(h('div', { class: 'card', 'data-testid': 'report-actual' },
    h('div', { class: 'row' }, h('span', { class: 'grow' }, '収入'), h('span', { class: 'amount is-income' }, `+${yen(r.income)}`)),
    h('div', { class: 'row' }, h('span', { class: 'grow' }, '固定費・返済・積立'), h('span', { class: 'amount' }, yen(r.fixed))),
    h('div', { class: 'row' }, h('span', { class: 'grow' }, '変動費', r.prevVariable !== null && r.prevVariable > 0 ? h('span', { class: 'muted small' }, `（前の期間 ${yen(r.prevVariable)}）`) : null), h('span', { class: 'amount' }, yen(r.variable))),
    h('div', { class: 'row', style: 'margin-top:6px;font-weight:700' }, h('span', { class: 'grow' }, '収支'), h('span', { class: 'amount' + (r.balance < 0 ? ' neg' : ''), 'data-testid': 'report-balance' }, signed(r.balance))),
    h('div', { class: 'muted small', style: 'margin-top:6px' }, `使わない日 ${r.noSpendDays} 日 / ${r.trackedDays} 日`),
  ));

  // アドバイスと役立ち情報
  root.appendChild(h('h2', null, 'あなたへのアドバイス'));
  root.appendChild(r.tips.length > 0 ? renderItems(store, r.tips, r.period.start, 'report-tips') : h('div', { class: 'card muted small' }, '特に気になる点はありません。この調子で。'));

  // 来月の見通し
  root.appendChild(h('h2', null, `来月（${r.next.label}）の見通し`));
  const f = r.forecast;
  root.appendChild(h('div', { class: 'card', 'data-testid': 'report-forecast' },
    h('div', { class: 'row' }, h('span', { class: 'grow' }, '収入（自動記録）'), h('span', { class: 'amount is-income' }, `+${yen(f.income)}`)),
    h('div', { class: 'row' }, h('span', { class: 'grow' }, '固定費（自動記録）'), h('span', { class: 'amount' }, yen(f.fixed))),
    h('div', { class: 'row' }, h('span', { class: 'grow' }, '変動費（ここ数か月の記録から）'), h('span', { class: 'amount' }, yen(f.variable))),
    h('div', { class: 'row', style: 'margin-top:6px;font-weight:700' }, h('span', { class: 'grow' }, '収支の見込み'), h('span', { class: 'amount' + (f.balance < 0 ? ' neg' : ''), 'data-testid': 'report-forecast-balance' }, signed(f.balance))),
    r.events.length > 0 ? h('div', { class: 'small', style: 'margin-top:8px' }, `ほかに予定: ${r.events.map((e) => `${e.label} ${yen(e.amount)}`).join('・')}（${monthLabel(r.next.end.slice(0, 7))}。ボーナスなどから）`) : null,
  ));

  if (r.lines.length > 0) {
    const table = h('div', { class: 'card tight', 'data-testid': 'report-lines' });
    for (const l of r.lines) {
      const over = l.budget !== null && l.actual > l.budget;
      table.appendChild(h('div', { class: 'list-item', 'data-testid': `report-line-${l.name}` },
        h('div', { class: 'row' },
          h('span', { class: 'grow', style: 'font-weight:700' }, l.name),
          h('span', { class: 'amount' + (l.nextBudget === null ? ' muted' : ''), style: 'font-size:16px' }, l.nextBudget !== null ? `来月の予算 ${yen(l.nextBudget)}` : `案 ${yen(l.suggested)}`),
        ),
        h('div', { class: 'recent-meta' + (over ? ' neg' : '') }, `先月 ${yen(l.actual)}${l.budget !== null ? ` / 予算 ${yen(l.budget)}` : ''} · 見込み ${yen(l.predicted)}`),
      ));
    }
    root.appendChild(table);
    const missing = r.lines.filter((l) => l.nextBudget === null && l.suggested > 0);
    if (missing.length > 0) {
      root.appendChild(h('button', { class: 'btn primary big', type: 'button', 'data-testid': 'report-apply-budget', style: 'margin-top:4px', onClick: async () => {
        for (const l of missing) await store.setBudget(l.id, r.next.start, l.suggested);
        toast(`来月の予算を ${missing.length} つ入れました（予算の画面で直せます）`);
      } }, '「案」で来月の予算を入れる'));
      root.appendChild(h('div', { class: 'muted small', style: 'margin-top:6px' }, '案は、ここ数か月の記録の見込みを 1,000 円単位にしたものです。減らしたい分類は、予算の画面で少し下げておくのがおすすめです。'));
    }
  }

  root.appendChild(h('div', { class: 'muted small', style: 'margin:16px 0' }, 'この画面は、あなたの記録だけを使って、この iPhone の中で計算しています（ほかの人には見えません）。'));
  return root;
}
