import { h } from '../dom';
import { yen } from '../../lib/money';
import { periodFor } from '../../lib/period';
import { statsFor, perDaySoFar, dailyTotals } from '../../lib/stats';
import { renderDailyChart } from '../dailyChart';
import { budgetStatus } from '../../lib/budget';
import { toDateString } from '../../lib/period';
import { categoryById } from '../../lib/categories';
import type { AppContext } from '../context';
import { toast } from '../toast';
import { INSTALL_STEPS, isIOS, isStandalone } from '../install';
import { syncStatusText } from './settings';
import { artworkElement } from '../art';
import { icon } from '../icons';

const INSTALL_DISMISSED_KEY = 'cf.installHintDismissed';
const WEEK = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];
/** 日別グラフで選んでいる日（画面を描き直しても保つ） */
let selectedDay: string | null = null;

export function renderHome(ctx: AppContext): HTMLElement {
  const { store } = ctx;
  const period = periodFor(new Date(), store.settings.month_start_day);
  const stats = statsFor(store.transactions, store.categories, period);
  const root = h('div', { 'data-testid': 'home' });

  const now = new Date();
  const MONTHS = ['JAN', 'FEB', 'MAR', 'APR', 'MAY', 'JUN', 'JUL', 'AUG', 'SEP', 'OCT', 'NOV', 'DEC'];
  const elapsed = period.totalDays - period.daysLeft + 1;
  root.appendChild(
    h('div', { class: 'masthead' },
      h('span', { class: 'title', 'data-testid': 'period-label' }, `${period.label}の支出`),
      h('span', { class: 'mono' }, `${MONTHS[now.getMonth()]} ${String(now.getDate()).padStart(2, '0')} · ${now.getFullYear()}`),
    ),
  );

  // 主役: 予算があれば「今月あと使える額」、なければ今月の変動費合計
  const bs = budgetStatus(store.budgets, store.transactions, store.categories, period);
  const shown = bs.hasBudget ? bs.remaining : stats.variableTotal;
  const digits = String(Math.abs(shown)).length;
  const totalText = yen(Math.abs(shown)).replace(/^¥/, '');
  root.appendChild(
    h('div', { class: 'hero' + (bs.hasBudget && bs.remaining < 0 ? ' over' : '') },
      artworkElement('ember', now.getFullYear() * 100 + now.getMonth() + 1),
      h('div', { class: 'label' }, bs.hasBudget ? (bs.remaining >= 0 ? 'Left to spend / あと使える' : 'Over budget / 予算超過') : 'Variable spend / 変動費'),
      h('div', { class: 'big' + (digits >= 7 ? ' xl' : digits >= 6 ? ' l' : ''), 'data-testid': bs.hasBudget ? 'remaining' : 'variable-total', 'aria-label': yen(shown) },
        h('span', { class: 'yen' }, shown < 0 ? '−¥' : '¥'), totalText),
      bs.hasBudget
        ? h('div', { class: 'sub' },
            h('span', null, 'PER DAY', h('b', { 'data-testid': 'per-day-left' }, yen(bs.perDayLeft))),
            h('span', null, 'SPENT', h('b', { 'data-testid': 'variable-total' }, yen(stats.variableTotal))),
            h('span', null, 'BUDGET', h('b', null, yen(bs.totalBudget))),
          )
        : h('div', { class: 'sub' },
            h('span', null, 'COUNT', h('b', null, String(stats.expenseCount))),
            h('span', null, 'PER DAY', h('b', null, yen(perDaySoFar(stats.variableTotal, period)))),
            h('span', null, 'INCOME', h('b', { 'data-testid': 'income-total', class: 'is-income' }, `+${yen(stats.incomeTotal)}`)),
          ),
      h('div', { class: 'progress', 'aria-hidden': 'true' }, h('i', { style: `width:${Math.round((elapsed / period.totalDays) * 100)}%` })),
      h('div', { class: 'progress-legend' },
        h('span', null, `Day ${elapsed} / ${period.totalDays}`),
        h('span', null, `残り ${period.daysLeft} 日`),
      ),
    ),
  );

  root.appendChild(
    h('div', { class: 'fab-wrap' },
      h('a', { class: 'btn primary big', href: '#/add', 'data-testid': 'go-add', style: 'text-decoration:none' }, icon('add'), '記録する'),
    ),
  );

  // 予算（大分類ごとの残り）
  if (bs.hasBudget) {
    root.appendChild(h('div', { class: 'row', style: 'margin-top:28px' }, h('h2', { class: 'grow', style: 'margin:0' }, '予算 / Budget'), h('a', { class: 'btn sm', href: '#/budget', style: 'text-decoration:none;margin-left:10px' }, '変更')));
    const card = h('div', { class: 'card tight budget-lines', 'data-testid': 'budget-lines', style: 'margin-top:10px' });
    for (const l of bs.lines) {
      const over = l.budget > 0 && l.remaining < 0;
      card.appendChild(h('div', { class: 'list-item' },
        h('div', { class: 'row' },
          h('span', { class: 'grow', style: 'font-weight:700' }, l.name),
          h('span', { class: 'amount', style: 'font-size:18px' }, l.budget > 0 ? (over ? `−${yen(-l.remaining)}` : yen(l.remaining)) : yen(l.spent)),
        ),
        l.budget > 0 ? h('div', { class: 'bar' + (over || l.ratio >= 0.8 ? ' over' : '') }, h('i', { style: `width:${Math.min(100, Math.round(l.ratio * 100))}%` })) : null,
        h('div', { class: 'recent-meta' }, l.budget > 0 ? `${yen(l.spent)} / ${yen(l.budget)} · ${Math.round(l.ratio * 100)}%${over ? ' · 超過' : ' · 残り'}` : '予算なし · 使った額'),
      ));
    }
    root.appendChild(card);
  } else if (store.budgets.length === 0) {
    root.appendChild(h('a', { class: 'banner', href: '#/budget', 'data-testid': 'budget-hint', style: 'display:block;text-decoration:none;margin-top:16px' },
      h('b', null, '予算を決める'), h('div', { class: 'small' }, '大分類ごとに予算を決めると、ここに「今月あといくら使えるか」が出ます。'),
    ));
  }

  // 日別
  root.appendChild(h('h2', null, '日別 / Daily'));
  root.appendChild(renderDaily(ctx, period));

  // 内訳
  const breakdown = h('div', { class: 'card tight', 'data-testid': 'breakdown' });
  if (stats.variableBreakdown.length === 0) {
    breakdown.appendChild(h('div', { class: 'list-item muted' }, 'まだ記録がありません。下の「記録する」から始めましょう。'));
  } else {
    const max = stats.variableBreakdown[0]!.amount || 1;
    stats.variableBreakdown.forEach((b, i) => {
      breakdown.appendChild(
        h('div', { class: 'list-item', 'data-testid': 'breakdown-row', style: 'align-items:flex-start' },
          h('span', { class: 'rank' }, String(i + 1).padStart(2, '0')),
          h('div', { class: 'grow' },
            h('div', { class: 'row' },
              h('span', { class: 'grow breakdown-name' }, b.name, h('span', { class: 'breakdown-meta' }, `${b.parentName} ・ ${b.count} 件`)),
              h('span', { class: 'amount' }, yen(b.amount)),
            ),
            h('div', { class: 'bar' }, h('i', { style: `width:${Math.max(3, Math.round((b.amount / max) * 100))}%` })),
          ),
        ),
      );
    });
  }
  root.appendChild(h('h2', null, '内訳 / Breakdown'));
  root.appendChild(breakdown);

  if (stats.fixedTotal > 0) {
    root.appendChild(
      h('div', { class: 'card row' }, h('span', { class: 'grow' }, '固定費・光熱費など'), h('span', { class: 'amount' }, yen(stats.fixedTotal))),
    );
  }

  // 最近の記録（直近 8 件）。間違えたらここで消せる
  // 最近の記録: 入力した順。まだ来ていない日付の自動記録（固定費の予定）は履歴でだけ見せる
  const todayStr = toDateString(new Date());
  const recent = store.liveTransactions
    .filter((t) => t.date >= period.start && t.date <= todayStr)
    .sort((a, b) => b.created_at.localeCompare(a.created_at) || b.date.localeCompare(a.date))
    .slice(0, 8);
  if (recent.length > 0) {
    root.appendChild(h('h2', null, '最近 / Recent'));
    const list = h('div', { class: 'card tight', 'data-testid': 'recent' });
    for (const t of recent) {
      const cat = categoryById(store.categories, t.category_id);
      const pm = store.paymentMethods.find((p) => p.id === t.payment_method_id);
      list.appendChild(
        h('div', { class: 'list-item', 'data-testid': 'recent-row' },
          h('a', { class: 'grow row-link', href: `#/edit?id=${t.id}`, 'data-testid': 'edit-link', 'aria-label': `${cat?.name ?? '記録'} ${yen(t.amount)} を修正` },
            h('div', null, cat?.name ?? '未分類', t.memo ? h('span', { class: 'muted small' }, ` ${t.memo}`) : null),
            h('div', { class: 'recent-meta' }, `${t.date.slice(5).replace('-', '/')}${pm ? ' · ' + pm.name : ''}`),
          ),
          h('span', { class: 'amount' + (t.type === 'income' ? ' is-income' : '') }, t.type === 'income' ? `+${yen(t.amount)}` : yen(t.amount)),
          h('button', {
            class: 'btn danger icon-btn', type: 'button', 'aria-label': '削除', title: '削除',
            onClick: async () => {
              await store.deleteTransaction(t.id);
              toast(`${cat?.name ?? '記録'} ${yen(t.amount)} を削除しました`, {
                actionLabel: '元に戻す',
                onAction: () => void store.restoreTransaction(t.id),
              });
            },
          }, icon('trash')),
        ),
      );
    }
    root.appendChild(list);
  }

  // 同期・ログイン状態
  const sync = ctx.syncer.getState();
  if (sync.status === 'signed_out' || sync.status === 'unconfigured') {
    root.appendChild(
      h('div', { class: 'banner', 'data-testid': 'login-banner' },
        'いまは iPhone の中だけに保存しています。',
        h('a', { href: '#/login' }, 'ログイン'),
        'すると自動でバックアップされ、機種変更しても引き継げます。',
      ),
    );
  } else {
    root.appendChild(h('div', { class: 'muted small', 'data-testid': 'sync-status' }, syncStatusText(sync)));
  }

  // ホーム画面に追加の案内（iPhone の Safari で開いているときだけ）
  if (isIOS() && !isStandalone() && !localStorage.getItem(INSTALL_DISMISSED_KEY)) {
    const hint = h('div', { class: 'banner', 'data-testid': 'install-hint' },
      h('div', null, h('b', null, 'ホーム画面に追加すると、アプリのようにすぐ開けます。')),
      h('ol', { class: 'steps small' }, INSTALL_STEPS.map((s) => h('li', null, s))),
      h('button', { class: 'btn sm', type: 'button', onClick: () => { localStorage.setItem(INSTALL_DISMISSED_KEY, '1'); hint.remove(); } }, 'あとで'),
    );
    root.appendChild(hint);
  }

  return root;
}

function renderDaily(ctx: AppContext, period: ReturnType<typeof periodFor>): HTMLElement {
  const { store } = ctx;
  const today = toDateString(new Date());
  const days = dailyTotals(store.transactions, store.categories, period);
  if (!selectedDay || !days.some((d) => d.date === selectedDay) || selectedDay > today) {
    selectedDay = days.some((d) => d.date === today) ? today : days[days.length - 1]?.date ?? null;
  }
  const card = h('div', { class: 'card daily-card', 'data-testid': 'daily' });
  const chartHost = h('div');
  const readout = h('div');
  card.append(chartHost, readout);

  const variableIds = new Set(store.categories.filter((c) => c.kind === 'variable').map((c) => c.id));
  const draw = () => {
    chartHost.replaceChildren(renderDailyChart({ days, today, selected: selectedDay, onSelect: (d) => { selectedDay = d; draw(); } }));
    const d = days.find((x) => x.date === selectedDay);
    if (!d) { readout.replaceChildren(); return; }
    const dt = new Date(Number(d.date.slice(0, 4)), Number(d.date.slice(5, 7)) - 1, Number(d.date.slice(8)));
    const items = store.liveTransactions
      .filter((t) => t.date === d.date && t.type === 'expense' && (t.category_id === null || variableIds.has(t.category_id)))
      .sort((a, b) => b.amount - a.amount);
    readout.replaceChildren(
      h('div', { class: 'day-readout', 'data-testid': 'day-readout' },
        h('span', { class: 'when' }, `${d.date.slice(5).replace('-', '/')} ${WEEK[dt.getDay()]}${d.date === today ? ' · 今日' : ''}`),
        h('span', { class: 'amt', 'data-testid': 'day-total' }, yen(d.amount)),
      ),
      items.length === 0
        ? h('div', { class: 'muted small', style: 'padding:6px 0 2px' }, 'この日の変動費の記録はありません。')
        : h('div', { class: 'day-items' }, items.map((t) =>
            h('a', { class: 'list-item row-link', href: `#/edit?id=${t.id}`, 'data-testid': 'day-item' },
              h('span', { class: 'grow' }, categoryById(store.categories, t.category_id)?.name ?? '未分類', t.memo ? h('span', { class: 'muted small' }, ` ${t.memo}`) : null),
              h('span', { class: 'amount', style: 'font-size:18px' }, yen(t.amount)),
              icon('chevron'),
            ))),
    );
  };
  draw();

  // 表で見る（グラフの代わりに数字で確認できるように）
  const rows = days.filter((d) => d.amount > 0).reverse();
  if (rows.length > 0) {
    card.appendChild(h('details', { class: 'day-table', 'data-testid': 'day-table' },
      h('summary', null, '一覧で見る / Table'),
      rows.map((d) => h('div', { class: 'list-item', style: 'padding:8px 0;min-height:36px' },
        h('span', { class: 'mono grow', style: 'color:var(--ink-2)' }, d.date.slice(5).replace('-', '/')),
        h('span', { class: 'muted small', style: 'margin-right:12px' }, `${d.count} 件`),
        h('span', { class: 'amount', style: 'font-size:17px' }, yen(d.amount)),
      )),
    ));
  }
  return card;
}
