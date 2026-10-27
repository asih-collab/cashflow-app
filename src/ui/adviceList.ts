// 改善アドバイス（F23）の表示。ホームには上位数件、サマリには全部。
// 各アドバイスに「役に立った / 立たない」を付け、月 1 回の見直しの材料にする（04 の 6 章）。
import { h } from './dom';
import { adviceContext, buildAdvice, type Advice } from '../lib/advice';
import { LIMITS } from '../lib/adviceRules';
import { periodFor, shiftPeriod } from '../lib/period';
import type { AppStore } from '../lib/store';
import { buildDailyAdvice, dailyContext } from '../lib/dailyAdvice';

const LEVEL_LABEL: Record<Advice['level'], string> = { warn: '注意', info: '参考', good: '順調' };

export function currentAdvice(store: AppStore, today = new Date()): { advice: Advice[]; periodStart: string } {
  const sd = store.settings.month_start_day;
  const period = periodFor(today, sd);
  const prev = shiftPeriod(period, 1, sd);
  const ctx = adviceContext({ transactions: store.transactions, categories: store.categories, budgets: store.budgets, debts: store.debts, rules: store.recurringRules, period, prev, today });
  return { advice: buildAdvice(ctx), periodStart: period.start };
}

export function renderAdviceList(store: AppStore, opts: { max?: number; testid: string; emptyText?: string }): HTMLElement | null {
  const { advice, periodStart } = currentAdvice(store);
  const shown = opts.max ? advice.slice(0, opts.max) : advice;
  if (shown.length === 0) {
    return opts.emptyText ? h('div', { class: 'card muted small', 'data-testid': opts.testid }, opts.emptyText) : null;
  }
  return renderItems(store, shown, periodStart, opts.testid);
}

/** 今日の気づき（その人の記録から、今日・昨日のこと）。なければ null */
export function renderDailyAdviceList(store: AppStore, testid: string, today = new Date()): HTMLElement | null {
  const period = periodFor(today, store.settings.month_start_day);
  const list = buildDailyAdvice(dailyContext({ transactions: store.transactions, categories: store.categories, budgets: store.budgets, period, today }));
  return list.length > 0 ? renderItems(store, list, period.start, testid) : null;
}

function renderItems(store: AppStore, shown: Advice[], periodStart: string, testid: string): HTMLElement {
  const list = h('div', { class: 'advice-list', 'data-testid': testid });
  for (const a of shown) {
    const fb = store.feedbackFor(periodStart, a.key);
    const thanks = h('span', { class: 'muted small advice-thanks' }, fb ? (fb.useful ? '役に立った' : '役に立たなかった') : '');
    const btn = (useful: boolean, label: string) => h('button', {
      type: 'button', class: 'chip sm' + (fb && fb.useful === useful ? ' on' : ''), 'data-testid': `advice-${useful ? 'yes' : 'no'}`, 'aria-pressed': String(!!fb && fb.useful === useful),
      onClick: async (e: Event) => {
        await store.setAdviceFeedback(periodStart, a, useful);
        const row = (e.currentTarget as HTMLElement).parentElement!;
        for (const b of Array.from(row.querySelectorAll('button'))) b.classList.toggle('on', b === e.currentTarget);
        thanks.textContent = 'ありがとうございます。見直しに使います';
      },
    }, label);
    list.appendChild(h('div', { class: `card advice ${a.level}`, 'data-testid': 'advice', 'data-rule': a.rule },
      h('div', { class: 'mono advice-level' }, LEVEL_LABEL[a.level]),
      a.href ? h('a', { class: 'advice-title', href: a.href }, a.title) : h('div', { class: 'advice-title' }, a.title),
      h('div', { class: 'advice-body' }, a.body),
      h('div', { class: 'row advice-fb' }, btn(true, '役に立った'), btn(false, '立たない'), thanks),
    ));
  }
  return list;
}

export const HOME_ADVICE_COUNT = LIMITS.homeCount;
