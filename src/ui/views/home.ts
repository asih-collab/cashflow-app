import { h } from '../dom';
import { yen } from '../../lib/money';
import { periodFor } from '../../lib/period';
import { statsFor, perDaySoFar } from '../../lib/stats';
import { categoryById } from '../../lib/categories';
import type { AppContext } from '../context';
import { toast } from '../toast';
import { INSTALL_STEPS, isIOS, isStandalone } from '../install';
import { syncStatusText } from './settings';
import { artworkElement } from '../art';
import { icon } from '../icons';

const INSTALL_DISMISSED_KEY = 'cf.installHintDismissed';

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

  // 主役: 今月の変動費合計（予算は段階 2）。背景は朱色の光
  const digits = String(stats.variableTotal).length;
  const totalText = yen(stats.variableTotal).replace(/^¥/, '');
  root.appendChild(
    h('div', { class: 'hero' },
      artworkElement('ember', now.getFullYear() * 100 + now.getMonth() + 1),
      h('div', { class: 'label' }, 'Variable spend / 変動費'),
      h('div', { class: 'big' + (digits >= 7 ? ' xl' : digits >= 6 ? ' l' : ''), 'data-testid': 'variable-total', 'aria-label': yen(stats.variableTotal) },
        h('span', { class: 'yen' }, '¥'), totalText),
      h('div', { class: 'sub' },
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
  const recent = store.liveTransactions
    .filter((t) => t.date >= period.start && t.date <= period.end)
    .sort((a, b) => (b.date + b.created_at).localeCompare(a.date + a.created_at))
    .slice(0, 8);
  if (recent.length > 0) {
    root.appendChild(h('h2', null, '最近 / Recent'));
    const list = h('div', { class: 'card tight', 'data-testid': 'recent' });
    for (const t of recent) {
      const cat = categoryById(store.categories, t.category_id);
      const pm = store.paymentMethods.find((p) => p.id === t.payment_method_id);
      list.appendChild(
        h('div', { class: 'list-item', 'data-testid': 'recent-row' },
          h('div', { class: 'grow' },
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
