// リボ・分割の残高（F08）: カードごとの残高・毎月の返済額・年率から、完済見込み月と手数料を出す。
// 返済を上乗せした場合にどれだけ早く終わるかも並べて見せる。
import { h } from '../dom';
import { yen, group } from '../../lib/money';
import { toDateString } from '../../lib/period';
import { daysSinceBalance, debtPlan, monthLabel, monthlyInterest, pendingLumps, totalPlan } from '../../lib/debt';
import type { AppContext, Route } from '../context';
import type { Debt } from '../../lib/types';
import { icon } from '../icons';
import { toast } from '../toast';
import { renderDebtChart } from '../debtChart';

const EXTRAS = [5000, 10000, 30000];
const STALE_DAYS = 35;

export function renderDebts(ctx: AppContext, route: Route): HTMLElement {
  const id = route.params.get('id');
  if (id) return renderDebtForm(ctx, id === 'new' ? null : ctx.store.debts.find((d) => d.id === id && !d.deleted_at) ?? null);
  const { store } = ctx;
  const debts = store.activeDebts;
  const root = h('div', { 'data-testid': 'debts' },
    h('div', { class: 'row' }, h('a', { href: '#/settings', style: 'display:inline-flex', 'aria-label': '戻る' }, icon('back')), h('h1', { class: 'grow', style: 'margin:0 0 0 8px' }, 'リボ・分割の残高')),
  );
  if (debts.length === 0) {
    root.appendChild(h('div', { class: 'card' },
      h('p', { style: 'margin-top:0' }, 'カードごとに「今の残高」「毎月の返済額」「手数料の年率」を入れると、いつ返し終わるかと、それまでに払う手数料が分かります。'),
      h('p', { class: 'muted small', style: 'margin-bottom:0' }, '残高はカード会社のアプリや明細で確認できます。月に 1 回、明細が来たら更新してください。'),
    ));
    root.appendChild(h('a', { class: 'btn primary big', href: '#/debts?id=new', 'data-testid': 'debt-add', style: 'text-decoration:none' }, icon('add'), 'カードを追加'));
    return root;
  }

  const today = new Date();
  const base = totalPlan(debts);
  const total = debts.reduce((a, d) => a + d.balance, 0);
  const monthly = debts.reduce((a, d) => a + d.monthly_payment, 0);
  const yearlyFee = debts.reduce((a, d) => a + monthlyInterest(d.balance, d.annual_rate), 0) * 12;

  root.appendChild(h('section', { class: 'hero', style: 'margin:0 -18px 8px' },
    h('div', { class: 'label' }, 'BALANCE / 残高の合計'),
    h('div', { class: 'big' + (group(total).length >= 9 ? ' xl' : group(total).length >= 7 ? ' l' : ''), 'data-testid': 'debt-total' }, h('span', { class: 'yen' }, '¥'), group(total)),
    h('div', { class: 'sub' },
      h('span', null, '完済見込み', h('b', { 'data-testid': 'debt-payoff' }, base.payoffMonth ? monthLabel(base.payoffMonth) : '終わらない')),
      h('span', null, '毎月', h('b', null, yen(monthly))),
    ),
    h('div', { class: 'sub', style: 'margin-top:8px' },
      h('span', null, 'うち手数料', h('b', { 'data-testid': 'debt-monthly-fee' }, yen(yearlyFee / 12))),
      h('span', null, '元金', h('b', null, yen(Math.max(0, monthly - yearlyFee / 12)))),
    ),
    h('div', { class: 'sub', style: 'margin-top:8px' },
      h('span', null, '手数料（今の残高で年）', h('b', { 'data-testid': 'debt-yearly-fee' }, yen(yearlyFee))),
      base.months !== null ? h('span', null, '完済までの手数料', h('b', null, yen(base.totalInterest))) : null,
    ),
  ));

  const stale = debts.filter((d) => daysSinceBalance(d, today) > STALE_DAYS);
  if (stale.length > 0) {
    root.appendChild(h('div', { class: 'banner', 'data-testid': 'debt-stale' }, `${stale.map((d) => d.name).join('・')} の残高が 1 か月以上前のままです。明細を見て更新すると、見込みが正確になります。`));
  }
  // 一括返済の予定（ボーナスなど）。見込みは予定込みで、しなかった場合と比べる
  const planned = debts.flatMap((d) => pendingLumps(d).map((l) => ({ d, l })));
  if (planned.length > 0) {
    const without = totalPlan(debts, 0, false);
    const lines = planned.map(({ d, l }) => `${monthLabel(l.month)}に ${d.name} へ ${yen(l.amount)}`).join('、');
    const effect = base.months !== null && without.months !== null
      ? `しない場合（${monthLabel(without.payoffMonth!)}・手数料 ${yen(without.totalInterest)}）より ${without.months - base.months} か月早く、手数料が ${yen(without.totalInterest - base.totalInterest)} 少なくなります。`
      : '';
    root.appendChild(h('div', { class: 'banner', 'data-testid': 'debt-lump-effect' }, h('b', null, '一括返済の予定込み: '), `${lines}。${effect}`));
  }
  // 固定費の自動記録（リボ・分割返済）との突き合わせ
  const rule = store.repaymentRule;
  if (rule && rule.amount !== monthly) {
    root.appendChild(h('div', { class: 'banner', 'data-testid': 'debt-rule-mismatch' },
      `固定費の自動記録「${rule.name}」は ${yen(rule.amount)} で、カードごとの返済額の合計 ${yen(monthly)} と違います。`,
      h('button', { class: 'btn sm primary', type: 'button', style: 'margin-top:8px', 'data-testid': 'debt-rule-align', onClick: async () => {
        await store.alignRepaymentRule();
        toast(`「${rule.name}」を ${yen(monthly)} にしました（今月分の記録も合わせて直します）`);
        ctx.navigate('/debts');
      } }, `${yen(monthly)} に合わせる`),
    ));
  } else if (rule) {
    root.appendChild(h('div', { class: 'muted small', style: 'margin:-2px 0 10px', 'data-testid': 'debt-rule-ok' }, `固定費の自動記録「${rule.name}」${yen(rule.amount)}（毎月 ${rule.day_of_month} 日）と一致しています。返済額を変えると自動で合わせます。`));
  }
  if (base.months === null) {
    root.appendChild(h('div', { class: 'banner' }, '毎月の返済額が手数料以下のカードがあり、このままでは残高が減りません。返済額を増やすか、下の「上乗せ」を試してください。'));
  }

  // 上乗せの比較
  root.appendChild(h('h2', null, '返済を増やすと / What if'));
  const chartCard = h('div', { class: 'card', 'data-testid': 'debt-chart' });
  const seg = h('div', { class: 'segmented', style: 'margin:0 0 12px' });
  let extra = EXTRAS[1]!;
  const msg = h('div', { class: 'small', style: 'margin-top:10px;line-height:1.6', 'data-testid': 'debt-extra-msg' });
  const chartHost = h('div');
  const drawExtra = () => {
    for (const b of Array.from(seg.children)) b.classList.toggle('on', (b as HTMLElement).dataset.v === String(extra));
    const alt = totalPlan(debts, extra);
    chartHost.replaceChildren(renderDebtChart([
      { name: '今のペース', cls: 'base', points: base.months === null ? base.schedule.slice(0, 61) : base.schedule },
      { name: `月 +${yen(extra)}`, cls: 'extra', points: alt.schedule },
    ]));
    if (alt.months === null) { msg.textContent = '上乗せしても終わりません。返済額を見直してください。'; return; }
    if (base.months === null) { msg.textContent = `月 ${yen(extra)} 上乗せすると、${monthLabel(alt.payoffMonth!)}に返し終わります。`; return; }
    const faster = base.months - alt.months;
    const saved = base.totalInterest - alt.totalInterest;
    msg.replaceChildren(
      `毎月 ${yen(extra)} 多く返すと、`, h('b', null, `${faster} か月早く`), `（${monthLabel(alt.payoffMonth!)}）返し終わり、手数料が `, h('b', null, `${yen(saved)} 少なく`), ' なります。年率の高いカードから先に返す計算です。',
    );
  };
  for (const v of EXTRAS) {
    seg.appendChild(h('button', { type: 'button', class: 'seg', 'data-v': String(v), 'data-testid': `debt-extra-${v}`, onClick: () => { extra = v; drawExtra(); } }, `+${group(v)}`));
  }
  chartCard.append(seg, chartHost, msg);
  root.appendChild(chartCard);
  drawExtra();

  // 数字で見る（グラフの表の代わり）
  const yearly = base.schedule.filter((p, i) => i === 0 || p.month.endsWith('-12') || p.balance === 0).slice(0, 12);
  root.appendChild(h('details', { class: 'card', style: 'padding:12px 18px' },
    h('summary', { class: 'small muted' }, '数字で見る（今のペースの年末の残高）'),
    h('div', null, yearly.map((p) => h('div', { class: 'list-item', style: 'min-height:40px;padding:8px 0' }, h('span', { class: 'grow' }, monthLabel(p.month)), h('span', { class: 'amount' }, yen(p.balance))))),
  ));

  // カードごと
  root.appendChild(h('h2', null, 'カードごと / Cards'));
  const list = h('div', { class: 'card tight', 'data-testid': 'debt-list' });
  for (const d of debts) {
    const p = debtPlan(d);
    list.appendChild(h('a', { class: 'list-item row-link', href: `#/debts?id=${d.id}`, 'data-testid': `debt-${d.name}`, style: 'flex-direction:row;align-items:center' },
      h('div', { class: 'grow', style: 'min-width:0' },
        h('div', { style: 'font-weight:700' }, d.name),
        h('div', { class: 'recent-meta' }, `毎月 ${yen(d.monthly_payment)} · 年 ${d.annual_rate}%`),
        h('div', { class: 'recent-meta' }, `${p.payoffMonth ? monthLabel(p.payoffMonth) + 'に完済' : '終わらない'} · ${d.balance_date.slice(5).replace('-', '/')} 時点`),
        pendingLumps(d).length > 0 ? h('div', { class: 'recent-meta' }, pendingLumps(d).map((l) => `${Number(l.month.slice(5))}月に ${yen(l.amount)} 一括返済`).join(' · ')) : null,
      ),
      h('span', { class: 'amount' }, yen(d.balance)),
      icon('chevron'),
    ));
  }
  root.appendChild(list);
  root.appendChild(h('a', { class: 'btn primary big', href: '#/debts?id=new', 'data-testid': 'debt-add', style: 'text-decoration:none;margin-top:4px' }, icon('add'), 'カードを追加'));
  root.appendChild(h('p', { class: 'muted small' }, '手数料は「残高 × 年率 ÷ 12」を毎月の返済から先に引く簡単な計算です。カード会社の実際の計算（日割りなど）とは少しずれます。'));
  return root;
}

function renderDebtForm(ctx: AppContext, debt: Debt | null): HTMLElement {
  const { store } = ctx;
  const num = (v: string) => Number(v.replace(/[^\d]/g, '')) || 0;
  const nameIn = h('input', { class: 'input', type: 'text', value: debt?.name ?? '', placeholder: '例: メインのカード', 'data-testid': 'debt-name', autocomplete: 'off' });
  const balIn = h('input', { class: 'input', type: 'text', inputmode: 'numeric', value: debt ? group(debt.balance) : '', placeholder: '0', 'data-testid': 'debt-balance' });
  const dateIn = h('input', { class: 'input', type: 'date', value: toDateString(new Date()), 'data-testid': 'debt-date' });
  const payIn = h('input', { class: 'input', type: 'text', inputmode: 'numeric', value: debt ? group(debt.monthly_payment) : '', placeholder: '0', 'data-testid': 'debt-monthly' });
  const rateIn = h('input', { class: 'input', type: 'text', inputmode: 'decimal', value: String(debt?.annual_rate ?? 15), 'data-testid': 'debt-rate' });
  for (const i of [balIn, payIn]) i.addEventListener('blur', () => { const v = num(i.value); i.value = v ? group(v) : ''; });

  const root = h('div', { 'data-testid': 'debt-form' },
    h('div', { class: 'row' }, h('a', { href: '#/debts', style: 'display:inline-flex', 'aria-label': '戻る' }, icon('back')), h('h1', { class: 'grow', style: 'margin:0 0 0 8px' }, debt ? '残高を更新' : 'カードを追加')),
    debt ? h('p', { class: 'muted small' }, `明細やカード会社のアプリで今の残高を見て、「今の残高」を入れ直して保存してください。前回: ${yen(debt.balance)}（${debt.balance_date.replace(/-/g, '/')}）`) : null,
    h('label', { class: 'field' }, h('span', null, '名前'), nameIn),
    h('label', { class: 'field' }, h('span', null, '今の残高（円）'), balIn),
    h('label', { class: 'field' }, h('span', null, '残高を確認した日'), dateIn),
    h('label', { class: 'field' }, h('span', null, '毎月の返済額（円・手数料込み）'), payIn),
    h('label', { class: 'field' }, h('span', null, '手数料の年率（%）'), rateIn),
    h('p', { class: 'muted small', style: 'margin-top:-4px' }, 'リボの年率は多くのカードで 15% です。分割払いの場合は、明細の手数料率を入れてください。'),
    h('button', { class: 'btn primary big', type: 'button', 'data-testid': 'debt-save', style: 'margin-top:8px', onClick: async () => {
      const name = nameIn.value.trim();
      const rate = Number(rateIn.value.replace(/[^\d.]/g, ''));
      if (!name) { toast('名前を入れてください'); return; }
      if (!Number.isFinite(rate) || rate > 30) { toast('年率は 0〜30 の数字で入れてください'); return; }
      const d = await store.saveDebt({ id: debt?.id, name, balance: num(balIn.value), balance_date: dateIn.value || toDateString(new Date()), monthly_payment: num(payIn.value), annual_rate: rate });
      const p = debtPlan(d);
      toast(`${name}: ${yen(d.balance)} ・ ${p.payoffMonth ? monthLabel(p.payoffMonth) + 'に完済の見込み' : 'このままでは終わりません'}`, { durationMs: 5000 });
      ctx.navigate('/debts');
    } }, '保存'),
  );
  if (debt) root.appendChild(renderLumps(ctx, debt, root));
  if (debt && debt.history.length > 0) {
    root.appendChild(h('h2', null, 'これまでの残高 / History'));
    root.appendChild(h('div', { class: 'card tight', 'data-testid': 'debt-history' },
      [...debt.history].reverse().map((p) => h('div', { class: 'list-item' }, h('span', { class: 'grow mono' }, p.date.replace(/-/g, '/')), h('span', { class: 'amount' }, yen(p.balance)))),
    ));
  }
  if (debt) {
    root.appendChild(h('button', { class: 'btn danger big', type: 'button', 'data-testid': 'debt-delete', style: 'margin-top:10px;width:100%', onClick: async () => {
      if (!confirm(`「${debt.name}」を消しますか？（返し終わった場合は、残高 0 で保存すると記録が残ります）`)) return;
      await store.deleteDebt(debt.id);
      toast(`${debt.name} を消しました`);
      ctx.navigate('/debts');
    } }, '消す'));
  }
  return root;
}

/** 一括返済の予定（ボーナスなど）。追加・取り消し。返したかどうかはホームの案内から */
function renderLumps(ctx: AppContext, debt: Debt, formRoot: HTMLElement): HTMLElement {
  const { store } = ctx;
  const wrap = h('div', { 'data-testid': 'debt-lumps' }, h('h2', null, '一括返済の予定 / Lump sum'));
  const lumps = debt.lumps ?? [];
  const card = h('div', { class: 'card' });
  if (lumps.length === 0) card.appendChild(h('p', { class: 'muted small', style: 'margin-top:0' }, 'ボーナスなどでまとめて返す予定を入れると、完済見込みに反映されます。その月になるとホームに案内が出ます。'));
  for (const l of lumps) {
    card.appendChild(h('div', { class: 'list-item', 'data-testid': `lump-${l.month}` },
      h('span', { class: 'grow' }, monthLabel(l.month), l.done ? h('span', { class: 'tag' }, '返済済み') : null),
      h('span', { class: 'amount' }, yen(l.amount)),
      l.done ? null : h('button', { class: 'btn sm danger', type: 'button', 'data-testid': `lump-remove-${l.month}`, onClick: async () => {
        const d = await store.setLump(debt.id, l.month, 0);
        if (d) formRoot.replaceWith(renderDebtForm(ctx, d));
      } }, '取り消す'),
    ));
  }
  const now = new Date();
  const defMonth = `${now.getFullYear()}-12`;
  const monthIn = h('input', { class: 'input', type: 'month', value: defMonth, min: `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`, 'data-testid': 'lump-month' });
  const amountIn = h('input', { class: 'input', type: 'text', inputmode: 'numeric', placeholder: '0', 'data-testid': 'lump-amount' });
  amountIn.addEventListener('blur', () => { const v = Number(amountIn.value.replace(/[^\d]/g, '')); amountIn.value = v ? group(v) : ''; });
  card.append(
    h('label', { class: 'field', style: 'margin-top:8px' }, h('span', null, '返す月'), monthIn),
    h('label', { class: 'field' }, h('span', null, '金額（円）'), amountIn),
    h('button', { class: 'btn primary', type: 'button', 'data-testid': 'lump-add', onClick: async () => {
      const amount = Number(amountIn.value.replace(/[^\d]/g, '')) || 0;
      if (!/^\d{4}-\d{2}$/.test(monthIn.value) || amount <= 0) { toast('月と金額を入れてください'); return; }
      const d = await store.setLump(debt.id, monthIn.value, amount);
      const p = d ? debtPlan(d) : null;
      toast(`${monthLabel(monthIn.value)}に ${yen(amount)} 返す予定を入れました${p?.payoffMonth ? `。${debt.name}は ${monthLabel(p.payoffMonth)}に完済の見込み` : ''}`, { durationMs: 5000 });
      if (d) formRoot.replaceWith(renderDebtForm(ctx, d));
    } }, '予定に追加'),
  );
  wrap.appendChild(card);
  return wrap;
}
