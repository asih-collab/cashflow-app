// リボ・分割の残高のまとめ（ホームとサマリで使う）。押すと「リボ・分割の残高」画面へ。
// 毎月の返済のうち、手数料に消える分と元金が減る分を 1 本の帯で見せる（2 区分なので文字でも両方出す）。
import { h } from './dom';
import { yen } from '../lib/money';
import { debtOverview, monthLabel } from '../lib/debt';
import type { AppStore } from '../lib/store';
import { icon } from './icons';

export function renderDebtCard(store: AppStore, testid: string): HTMLElement | null {
  const o = debtOverview(store.activeDebts);
  if (!o) return null;
  const feeShare = o.monthly > 0 ? Math.min(1, o.interestNow / o.monthly) : 0;
  return h('a', { class: 'card debt-card row-link', href: '#/debts', 'data-testid': testid },
    h('div', { class: 'row', style: 'align-items:baseline' },
      h('div', { class: 'grow' },
        h('div', { class: 'mono' }, 'DEBT / リボ・分割の残高'),
        h('div', { class: 'debt-card-total', 'data-testid': `${testid}-total` }, yen(o.total)),
      ),
      icon('chevron'),
    ),
    h('div', { class: 'recent-meta', style: 'white-space:normal' },
      o.payoffMonth ? `完済見込み ${monthLabel(o.payoffMonth)}（あと ${o.months} か月）` : 'このままでは残高が減りません',
      o.changeSinceLast !== null ? ` · 前回より ${o.changeSinceLast <= 0 ? '−' : '+'}${yen(Math.abs(o.changeSinceLast))}` : '',
    ),
    h('div', { class: 'debt-split', role: 'img', 'aria-label': `毎月の返済 ${yen(o.monthly)} のうち、手数料 ${yen(o.interestNow)}、元金 ${yen(o.principalNow)}` },
      h('i', { class: 'fee', style: `width:${feeShare * 100}%` }),
      h('i', { class: 'principal', style: `width:${(1 - feeShare) * 100}%` }),
    ),
    h('div', { class: 'debt-split-legend' },
      h('span', null, h('i', { class: 'fee' }), '手数料 ', h('b', { 'data-testid': `${testid}-fee` }, yen(o.interestNow))),
      h('span', null, h('i', { class: 'principal' }), '元金 ', h('b', null, yen(o.principalNow))),
      h('span', { class: 'muted' }, `/ 毎月 ${yen(o.monthly)}`),
    ),
    h('div', { class: 'muted small', style: 'margin-top:6px' }, `今の残高のままだと手数料は年 ${yen(o.yearlyFee)}${o.totalInterest !== null ? ` · 完済までに ${yen(o.totalInterest)}` : ''}`),
  );
}
