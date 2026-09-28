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

  root.appendChild(
    h('div', { class: 'row', style: 'margin-bottom:10px' },
      h('div', { class: 'grow' }, h('div', { class: 'eyebrow' }, '今月'), h('h1', { style: 'margin:2px 0 0' }, `${period.label}の支出`)),
      h('span', { class: 'muted small' }, `残り ${period.daysLeft} 日`),
    ),
  );

  // 主役: 今月の変動費合計（予算は段階 2）。背景はアートワーク
  const now = new Date();
  root.appendChild(
    h('div', { class: 'card hero' },
      artworkElement('dusk', now.getFullYear() * 100 + now.getMonth() + 1),
      h('div', { class: 'corner' }, `${now.getMonth() + 1}.${String(now.getDate()).padStart(2, '0')}`),
      h('div', { class: 'label' }, '変動費の合計'),
      h('div', { class: 'big', 'data-testid': 'variable-total' }, yen(stats.variableTotal)),
      h('div', { class: 'sub' },
        `${stats.expenseCount} 件 ・ 1 日あたり ${yen(perDaySoFar(stats.variableTotal, period))}`,
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
    for (const b of stats.variableBreakdown) {
      breakdown.appendChild(
        h('div', { class: 'list-item', 'data-testid': 'breakdown-row' },
          h('div', { class: 'grow' },
            h('div', { class: 'row' },
              h('span', { class: 'grow breakdown-name' }, b.name, h('span', { class: 'breakdown-meta' }, `${b.parentName} ・ ${b.count} 件`)),
              h('span', { class: 'amount' }, yen(b.amount)),
            ),
            h('div', { class: 'bar' }, h('i', { style: `width:${Math.max(3, Math.round((b.amount / max) * 100))}%` })),
          ),
        ),
      );
    }
  }
  root.appendChild(h('h2', null, '中分類ごとの内訳'));
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
    root.appendChild(h('h2', null, '最近の記録'));
    const list = h('div', { class: 'card tight', 'data-testid': 'recent' });
    for (const t of recent) {
      const cat = categoryById(store.categories, t.category_id);
      const pm = store.paymentMethods.find((p) => p.id === t.payment_method_id);
      list.appendChild(
        h('div', { class: 'list-item', 'data-testid': 'recent-row' },
          h('div', { class: 'grow' },
            h('div', null, cat?.name ?? '未分類', t.memo ? h('span', { class: 'muted small' }, ` ${t.memo}`) : null),
            h('div', { class: 'muted small' }, `${t.date.slice(5).replace('-', '/')}${pm ? ' ・ ' + pm.name : ''}`),
          ),
          h('span', { class: 'amount' }, yen(t.amount)),
          h('button', {
            class: 'btn sm danger', type: 'button', 'aria-label': '削除', title: '削除',
            onClick: async () => {
              await store.deleteTransaction(t.id);
              toast(`${cat?.name ?? '記録'} ${yen(t.amount)} を削除しました`, {
                actionLabel: '元に戻す',
                onAction: () => void store.restoreTransaction(t.id),
              });
            },
          }, icon('trash'), '削除'),
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
