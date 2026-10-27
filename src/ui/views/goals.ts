// 貯金の目標（旅行資金など）と、節約のチャレンジ（回数・金額の上限）。#/goals、#/goals?id=、#/goals?ch=
import { h } from '../dom';
import { group, yen } from '../../lib/money';
import { goalHidden, goalLabel, goalStatus } from '../../lib/goal';
import { hasPin, isUnlocked, lock, setPin, unlock, validPin } from '../../lib/privacy';
import { monthLabel } from '../../lib/debt';
import { challengeStatus, formatChallenge } from '../../lib/challenge';
import { childrenOf, parentsOf } from '../../lib/categories';
import { periodFor } from '../../lib/period';
import type { AppContext, Route } from '../context';
import type { Challenge, Goal } from '../../lib/types';
import { icon } from '../icons';
import { toast } from '../toast';

const num = (v: string) => Number(v.replace(/[^\d]/g, '')) || 0;
const moneyInput = (testid: string, value = 0) => {
  const i = h('input', { class: 'input', type: 'text', inputmode: 'numeric', value: value ? group(value) : '', placeholder: '0', 'data-testid': testid });
  i.addEventListener('blur', () => { const v = num(i.value); i.value = v ? group(v) : ''; });
  return i;
};
const thisMonth = () => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };

export function renderGoals(ctx: AppContext, route: Route): HTMLElement {
  const id = route.params.get('id');
  if (id) {
    const g = id === 'new' ? null : ctx.store.goals.find((x) => x.id === id && !x.deleted_at) ?? null;
    if (g && goalHidden(g)) return renderPinGate(ctx, () => ctx.navigate(`/goals?id=${g.id}`));
    return renderGoalForm(ctx, g);
  }
  if (route.params.get('unlock')) return renderPinGate(ctx, () => ctx.navigate('/goals'));
  const ch = route.params.get('ch');
  if (ch) return renderChallengeForm(ctx, ch === 'new' ? null : ctx.store.challenges.find((c) => c.id === ch && !c.deleted_at) ?? null);
  const { store } = ctx;
  const root = h('div', { 'data-testid': 'goals' },
    h('div', { class: 'row' }, h('a', { href: '#/settings', style: 'display:inline-flex', 'aria-label': '戻る' }, icon('back')), h('h1', { class: 'grow', style: 'margin:0 0 0 8px' }, '貯金と節約')),
  );
  root.appendChild(h('h2', null, '貯金の目標 / Goals'));
  if (store.activeGoals.length === 0) root.appendChild(h('div', { class: 'card muted small' }, '旅行・引っ越しなどの目標を作ると、毎月の先取りとボーナスの予定から「いつ届くか」が出ます。'));
  for (const g of store.visibleGoals) root.appendChild(goalCard(ctx, g, `goal-${g.name}`, `#/goals?id=${g.id}`));
  const hidden = store.activeGoals.filter(goalHidden);
  if (hidden.length > 0) {
    root.appendChild(h('div', { class: 'card row', 'data-testid': 'goals-locked' },
      h('span', { class: 'grow small' }, `鍵付きの目標 ${hidden.length} 件`),
      h('a', { class: 'btn sm', href: '#/goals?unlock=1', 'data-testid': 'goals-unlock', style: 'text-decoration:none' }, '開く')));
  } else if (store.activeGoals.some((g) => g.is_private)) {
    root.appendChild(h('button', { class: 'btn sm', type: 'button', 'data-testid': 'goals-lock', style: 'margin-bottom:10px', onClick: () => { lock(); ctx.navigate('/goals'); } }, '鍵付きの目標を隠す'));
  }
  root.appendChild(h('a', { class: 'btn primary', href: '#/goals?id=new', 'data-testid': 'goal-add', style: 'text-decoration:none;width:100%' }, icon('add'), '目標を作る'));

  root.appendChild(h('h2', null, '節約のチャレンジ / Limits'));
  const period = periodFor(new Date(), store.settings.month_start_day);
  const list = h('div', { class: 'card tight', 'data-testid': 'challenge-list' });
  if (store.activeChallenges.length === 0) list.appendChild(h('div', { class: 'list-item muted small' }, '「飲み会は月 2 回まで」「ギャンブルは月 1 万円まで」のように上限を決めると、記録するときとホームで残りが分かります。'));
  for (const c of store.activeChallenges) {
    const s = challengeStatus(c, store.transactions, period);
    list.appendChild(h('a', { class: 'list-item row-link', href: `#/goals?ch=${c.id}`, 'data-testid': `challenge-${c.name}`, style: 'flex-direction:row;align-items:center' },
      h('div', { class: 'grow' }, h('div', { style: 'font-weight:700' }, c.name), h('div', { class: 'recent-meta' }, `${c.kind === 'count' ? '回数' : '金額'}の上限 · ${c.category_ids.map((id) => store.categories.find((x) => x.id === id)?.name ?? '').join('・')}`)),
      h('span', { class: 'amount' + (s.over ? ' over' : '') }, formatChallenge(s, c.kind)),
      icon('chevron'),
    ));
  }
  root.appendChild(list);
  root.appendChild(h('a', { class: 'btn', href: '#/goals?ch=new', 'data-testid': 'challenge-add', style: 'text-decoration:none;width:100%' }, icon('add'), 'チャレンジを作る'));
  return root;
}

/** 目標のカード（ホーム・一覧で使う） */
export function goalCard(ctx: AppContext, g: Goal, testid: string, href: string): HTMLElement {
  const s = goalStatus(g, ctx.store.transactions, ctx.store.recurringRules, new Date());
  return h('a', { class: 'card goal-card row-link', href, 'data-testid': testid },
    h('div', { class: 'row', style: 'align-items:baseline' },
      h('div', { class: 'grow' }, h('div', { class: 'mono' }, `GOAL / ${goalLabel(g)}${g.is_private ? ' · 鍵付き' : ''}`), h('div', { class: 'goal-total', 'data-testid': `${testid}-total` }, yen(s.total), h('span', { class: 'muted small' }, ` / ${yen(g.target)}`))),
      icon('chevron'),
    ),
    h('div', { class: 'goal-bar', role: 'img', 'aria-label': `${Math.round(s.ratio * 100)}%` }, h('i', { style: `width:${s.ratio * 100}%` })),
    h('div', { class: 'recent-meta', style: 'white-space:normal', 'data-testid': `${testid}-reach` },
      s.total >= g.target ? '達成しました' : s.reachMonth ? `達成見込み ${monthLabel(s.reachMonth)}（あと ${s.monthsLeft} か月）` : '今の入金では 10 年以内に届きません',
      ` · ${Math.round(s.ratio * 100)}% · 毎月 ${yen(s.monthlyNow)}`,
      s.assets > 0 ? ` · うち${(g.assets ?? []).map((a) => a.name).join('・')} ${yen(s.assets)}` : '',
    ),
    s.nextExtra ? h('div', { class: 'small', style: 'margin-top:6px' }, `次の入金の予定: ${monthLabel(s.nextExtra.month)} ${yen(s.nextExtra.amount)}`) : null,
  );
}

function renderGoalForm(ctx: AppContext, goal: Goal | null): HTMLElement {
  const { store } = ctx;
  const nameIn = h('input', { class: 'input', type: 'text', value: goal?.name ?? '', placeholder: '例: 旅行資金', 'data-testid': 'goal-name', autocomplete: 'off' });
  const targetIn = moneyInput('goal-target', goal?.target);
  const root = h('div', { 'data-testid': 'goal-form' },
    h('div', { class: 'row' }, h('a', { href: '#/goals', style: 'display:inline-flex', 'aria-label': '戻る' }, icon('back')), h('h1', { class: 'grow', style: 'margin:0 0 0 8px' }, goal ? goal.name : '目標を作る')),
  );
  const rerender = (g: Goal | undefined) => { if (g) root.replaceWith(renderGoalForm(ctx, g)); };

  if (!goal) {
    const privacyFields = privacyOptions(ctx, false, '貯金');
    const monthlyIn = moneyInput('goal-monthly');
    const dayIn = h('select', { class: 'input', 'data-testid': 'goal-day' });
    for (let d = 1; d <= 31; d++) dayIn.appendChild(h('option', { value: String(d), selected: d === 25 }, `${d} 日`));
    root.append(
      h('label', { class: 'field' }, h('span', null, '名前'), nameIn),
      h('label', { class: 'field' }, h('span', null, '目標額（円）'), targetIn),
      h('label', { class: 'field' }, h('span', null, '毎月の先取り（円。来月から自動で記録）'), monthlyIn),
      h('label', { class: 'field' }, h('span', null, '先取りする日（給料日など）'), dayIn),
      h('p', { class: 'muted small' }, '先取りは「固定費の自動記録」として毎月入り、使える額から先に引かれます。実際のお金は、銀行の自動積立などで別の口座に移してください。'),
      privacyFields.wrap,
      h('button', { class: 'btn primary big', type: 'button', 'data-testid': 'goal-save', onClick: async () => {
        if (!nameIn.value.trim() || num(targetIn.value) <= 0) { toast('名前と目標額を入れてください'); return; }
        if (!(await privacyFields.ready())) return;
        const g = await store.createGoal({ name: nameIn.value, target: num(targetIn.value), monthly: num(monthlyIn.value), day: Number(dayIn.value), private: privacyFields.on(), alias: privacyFields.alias() });
        toast(`${g.name}（${yen(g.target)}）を作りました`);
        ctx.navigate(`/goals?id=${g.id}`);
      } }, '作る'),
    );
    return root;
  }

  root.append(goalCard(ctx, goal, 'goal-detail', '#/goals'));
  root.append(
    h('label', { class: 'field' }, h('span', null, '名前'), nameIn),
    h('label', { class: 'field' }, h('span', null, '目標額（円）'), targetIn),
    h('button', { class: 'btn', type: 'button', 'data-testid': 'goal-update', onClick: async () => {
      rerender(await store.updateGoal(goal.id, { name: nameIn.value.trim() || goal.name, target: num(targetIn.value) || goal.target }));
      toast('保存しました');
    } }, '名前・目標額を保存'),
  );

  // 先取り（固定費の自動記録）
  const rules = store.goalRules(goal);
  root.append(h('h2', null, '毎月の先取り / Monthly'),
    h('div', { class: 'card tight', 'data-testid': 'goal-rules' },
      rules.length === 0 ? h('div', { class: 'list-item muted small' }, 'まだありません。') : null,
      rules.map((r) => h('a', { class: 'list-item row-link', href: `#/recurring?id=${r.id}`, style: 'flex-direction:row;align-items:center' },
        h('div', { class: 'grow' }, h('div', null, r.name), h('div', { class: 'recent-meta' }, `毎月 ${r.day_of_month} 日 · ${monthLabel(r.start_month)}から`)),
        h('span', { class: 'amount' }, yen(r.amount)), icon('chevron'))),
    ),
    h('a', { class: 'btn sm', href: '#/recurring?id=new', style: 'text-decoration:none' }, '先取りを追加（固定費の自動記録で、カテゴリを「' + (store.categories.find((c) => c.id === goal.category_id)?.name ?? goal.name) + '」に）'),
  );

  // 当てにする資産・入金の予定・増やす予定（同じ形の一覧）
  const listSection = <T extends Record<string, unknown>>(title: string, testid: string, items: T[], row: (x: T) => (string | Node)[], remove: (x: T) => Promise<Goal | undefined>, addFields: HTMLElement[], add: () => Promise<Goal | undefined>, note: string) => {
    root.append(h('h2', null, title), h('div', { class: 'card', 'data-testid': testid },
      h('p', { class: 'muted small', style: 'margin-top:0' }, note),
      items.map((x, i) => h('div', { class: 'list-item', 'data-testid': `${testid}-${i}` }, ...row(x),
        h('button', { class: 'btn sm danger', type: 'button', onClick: async () => rerender(await remove(x)) }, '消す'))),
      ...addFields,
      h('button', { class: 'btn primary', type: 'button', 'data-testid': `${testid}-add`, onClick: async () => rerender(await add()) }, '追加'),
    ));
  };

  const assetName = h('input', { class: 'input', type: 'text', placeholder: '例: NISA の残高', 'data-testid': 'asset-name' });
  const assetAmount = moneyInput('asset-amount');
  listSection('当てにする資産 / Assets', 'goal-assets', goal.assets ?? [],
    (a) => [h('span', { class: 'grow' }, a.name), h('span', { class: 'amount' }, yen(a.amount))],
    (a) => store.updateGoal(goal.id, { assets: goal.assets.filter((x) => x !== a) }),
    [h('label', { class: 'field' }, h('span', null, '名前'), assetName), h('label', { class: 'field' }, h('span', null, '金額（円）'), assetAmount)],
    async () => {
      if (!assetName.value.trim() || num(assetAmount.value) <= 0) { toast('名前と金額を入れてください'); return undefined; }
      const rest = (goal.assets ?? []).filter((x) => x.name !== assetName.value.trim());
      return store.updateGoal(goal.id, { assets: [...rest, { name: assetName.value.trim(), amount: num(assetAmount.value) }] });
    },
    'NISA や預金など、この目標に使うつもりのお金。貯まった額に含めます（値動きのあるものは、ときどき金額を直してください。同じ名前で追加すると上書き）。');

  const exMonth = h('input', { class: 'input', type: 'month', value: `${new Date().getFullYear()}-12`, 'data-testid': 'extra-month' });
  const exAmount = moneyInput('extra-amount');
  listSection('入金の予定 / Planned', 'goal-extras', goal.extras ?? [],
    (x) => [h('span', { class: 'grow' }, monthLabel(x.month), x.done ? h('span', { class: 'tag' }, '入金済み') : null), h('span', { class: 'amount' }, yen(x.amount))],
    (x) => store.updateGoal(goal.id, { extras: goal.extras.filter((y) => y !== x) }),
    [h('label', { class: 'field' }, h('span', null, '月'), exMonth), h('label', { class: 'field' }, h('span', null, '金額（円）'), exAmount)],
    async () => {
      if (!/^\d{4}-\d{2}$/.test(exMonth.value) || num(exAmount.value) <= 0) { toast('月と金額を入れてください'); return undefined; }
      const rest = (goal.extras ?? []).filter((x) => x.month !== exMonth.value || x.done);
      return store.updateGoal(goal.id, { extras: [...rest, { month: exMonth.value, amount: num(exAmount.value), done: false }] });
    },
    'ボーナスなどからまとめて入れる予定。その月になるとホームに案内が出て、「入金した」で記録されます。');

  const incFrom = h('input', { class: 'input', type: 'month', value: thisMonth(), 'data-testid': 'inc-from' });
  const incAmount = moneyInput('inc-amount');
  listSection('毎月の入金を増やす予定 / Step up', 'goal-increases', goal.increases ?? [],
    (x) => [h('span', { class: 'grow' }, `${monthLabel(x.from)}から`), h('span', { class: 'amount' }, `+${yen(x.amount)}`)],
    (x) => store.updateGoal(goal.id, { increases: goal.increases.filter((y) => y !== x) }),
    [h('label', { class: 'field' }, h('span', null, 'いつから'), incFrom), h('label', { class: 'field' }, h('span', null, '毎月増やす額（円）'), incAmount)],
    async () => {
      if (!/^\d{4}-\d{2}$/.test(incFrom.value) || num(incAmount.value) <= 0) { toast('月と金額を入れてください'); return undefined; }
      return store.updateGoal(goal.id, { increases: [...(goal.increases ?? []), { from: incFrom.value, amount: num(incAmount.value) }] });
    },
    'リボを返し終わって返済の分が浮く月などから、毎月の入金を増やす見込み。その月が来たら、先取りの金額も直してください。');

  // 鍵（同じ iPhone を見る人に見せない）
  const pf = privacyOptions(ctx, !!goal.is_private, goal.alias || '貯金');
  root.append(h('h2', null, '鍵 / Privacy'), h('div', { class: 'card' }, pf.wrap,
    h('button', { class: 'btn', type: 'button', 'data-testid': 'goal-privacy-save', onClick: async () => {
      if (!(await pf.ready())) return;
      rerender(await store.setGoalPrivate(goal.id, pf.on(), pf.alias()));
      toast(pf.on() ? `鍵をかけました。ほかの画面では「${pf.alias()}」と表示します` : '鍵を外しました');
    } }, '鍵の設定を保存')));

  root.appendChild(h('button', { class: 'btn danger big', type: 'button', 'data-testid': 'goal-delete', style: 'margin-top:16px;width:100%', onClick: async () => {
    if (!confirm(`「${goal.name}」の目標を消しますか？（記録と先取りの自動記録は残ります）`)) return;
    await store.deleteGoal(goal.id);
    ctx.navigate('/goals');
  } }, '目標を消す'));
  return root;
}

function renderChallengeForm(ctx: AppContext, c: Challenge | null): HTMLElement {
  const { store } = ctx;
  let kind: Challenge['kind'] = c?.kind ?? 'count';
  const nameIn = h('input', { class: 'input', type: 'text', value: c?.name ?? '', placeholder: '例: 飲み会は月 2 回まで', 'data-testid': 'challenge-name', autocomplete: 'off' });
  const limitIn = h('input', { class: 'input', type: 'text', inputmode: 'numeric', value: c ? group(c.limit) : '', placeholder: '0', 'data-testid': 'challenge-limit' });
  const limitLabel = h('span');
  const tabC = h('button', { type: 'button', class: 'seg', 'data-testid': 'challenge-count', onClick: () => setKind('count') }, '回数');
  const tabA = h('button', { type: 'button', class: 'seg', 'data-testid': 'challenge-amount', onClick: () => setKind('amount') }, '金額');
  function setKind(k: Challenge['kind']) {
    kind = k;
    tabC.classList.toggle('on', k === 'count');
    tabA.classList.toggle('on', k === 'amount');
    limitLabel.textContent = k === 'count' ? '1 か月の上限（回）' : '1 か月の上限（円）';
  }
  const selected = new Set(c?.category_ids ?? []);
  const cats = h('div', { class: 'card', 'data-testid': 'challenge-cats' });
  for (const p of parentsOf(store.categories).filter((x) => x.kind === 'variable')) {
    const kids = childrenOf(store.categories, p.id).filter((x) => x.is_active);
    if (kids.length === 0) continue;
    cats.appendChild(h('div', { class: 'mono', style: 'margin:8px 0 4px' }, p.name));
    cats.appendChild(h('div', { class: 'row', style: 'flex-wrap:wrap;gap:6px' }, kids.map((k) => {
      const b = h('button', { type: 'button', class: 'chip sm' + (selected.has(k.id) ? ' on' : ''), 'data-testid': `challenge-cat-${k.name}`, onClick: () => {
        if (selected.has(k.id)) selected.delete(k.id); else selected.add(k.id);
        b.classList.toggle('on', selected.has(k.id));
      } }, k.name);
      return b;
    })));
  }
  const root = h('div', { 'data-testid': 'challenge-form' },
    h('div', { class: 'row' }, h('a', { href: '#/goals', style: 'display:inline-flex', 'aria-label': '戻る' }, icon('back')), h('h1', { class: 'grow', style: 'margin:0 0 0 8px' }, c ? 'チャレンジを編集' : 'チャレンジを作る')),
    h('label', { class: 'field' }, h('span', null, '名前'), nameIn),
    h('div', { class: 'segmented', style: 'margin:0 0 14px;display:inline-flex' }, tabC, tabA),
    h('label', { class: 'field' }, limitLabel, limitIn),
    h('div', { class: 'mono', style: 'margin:6px 0' }, '対象のカテゴリ'),
    cats,
    h('button', { class: 'btn primary big', type: 'button', 'data-testid': 'challenge-save', onClick: async () => {
      if (!nameIn.value.trim() || selected.size === 0) { toast('名前と対象のカテゴリを選んでください'); return; }
      await store.saveChallenge({ id: c?.id, name: nameIn.value, kind, category_ids: [...selected], limit: num(limitIn.value) });
      toast('保存しました');
      ctx.navigate('/goals');
    } }, '保存'),
    c ? h('button', { class: 'btn danger big', type: 'button', style: 'margin-top:10px;width:100%', 'data-testid': 'challenge-delete', onClick: async () => { await store.deleteChallenge(c.id); ctx.navigate('/goals'); } }, 'やめる') : null,
  );
  setKind(kind);
  return root;
}

/** 鍵の設定欄（鍵をかける・別名・この端末の暗証番号）。ready() は暗証番号の準備ができていれば true */
function privacyOptions(ctx: AppContext, initial: boolean, alias: string) {
  const onIn = h('input', { class: 'toggle', type: 'checkbox', checked: initial, 'data-testid': 'goal-private' });
  const aliasIn = h('input', { class: 'input', type: 'text', value: alias, 'data-testid': 'goal-alias' });
  const pinIn = h('input', { class: 'input', type: 'password', inputmode: 'numeric', autocomplete: 'off', placeholder: '4〜8 桁の数字', 'data-testid': 'pin-new' });
  const pinIn2 = h('input', { class: 'input', type: 'password', inputmode: 'numeric', autocomplete: 'off', placeholder: 'もう一度', 'data-testid': 'pin-new2' });
  const pinBox = h('div', { hidden: true }, h('p', { class: 'small', style: 'margin:8px 0' }, 'この iPhone の暗証番号を決めてください（この端末にだけ保存します）。'), h('label', { class: 'field' }, h('span', null, '暗証番号'), pinIn), h('label', { class: 'field' }, h('span', null, '確認'), pinIn2));
  const extra = h('div', { hidden: !initial }, h('label', { class: 'field' }, h('span', null, 'ほかの画面での名前（記録・固定費・サマリ）'), aliasIn), pinBox);
  let needPin = false;
  void hasPin(ctx.store.db).then((has) => { needPin = !has; pinBox.hidden = has; });
  onIn.addEventListener('change', () => { extra.hidden = !onIn.checked; });
  const wrap = h('div', null,
    h('label', { class: 'list-item', style: 'border:0' }, h('span', { class: 'grow' }, '鍵をかける', h('div', { class: 'muted small' }, '暗証番号で開くまで、ホームと一覧にこの目標を出しません。開いた状態は、アプリを閉じると元に戻ります。')), onIn),
    extra,
  );
  return {
    wrap,
    on: () => onIn.checked,
    alias: () => aliasIn.value.trim() || '貯金',
    async ready(): Promise<boolean> {
      if (!onIn.checked || !needPin) return true;
      if (!validPin(pinIn.value)) { toast('暗証番号は 4〜8 桁の数字にしてください'); return false; }
      if (pinIn.value !== pinIn2.value) { toast('暗証番号が一致しません'); return false; }
      await setPin(ctx.store.db, pinIn.value);
      needPin = false;
      return true;
    },
  };
}

/** 鍵付きの目標を開く（暗証番号） */
function renderPinGate(ctx: AppContext, onOpen: () => void): HTMLElement {
  const pin = h('input', { class: 'input', type: 'password', inputmode: 'numeric', autocomplete: 'off', placeholder: '暗証番号', 'data-testid': 'pin' });
  const open = async () => {
    if (isUnlocked() || (await unlock(ctx.store.db, pin.value))) onOpen();
    else { toast('暗証番号が違います'); pin.value = ''; pin.focus(); }
  };
  pin.addEventListener('keydown', (e) => { if ((e as KeyboardEvent).key === 'Enter') void open(); });
  const root = h('div', { 'data-testid': 'pin-gate' },
    h('div', { class: 'row' }, h('a', { href: '#/goals', style: 'display:inline-flex', 'aria-label': '戻る' }, icon('back')), h('h1', { class: 'grow', style: 'margin:0 0 0 8px' }, '鍵付きの目標')),
    h('p', { class: 'small muted' }, 'この iPhone の暗証番号を入れてください。'),
    pin,
    h('button', { class: 'btn primary big', type: 'button', 'data-testid': 'pin-open', style: 'margin-top:12px', onClick: () => void open() }, '開く'),
  );
  void hasPin(ctx.store.db).then((has) => {
    if (!has) root.replaceChildren(root.firstChild!, h('p', { class: 'small' }, 'この iPhone ではまだ暗証番号が決まっていません。目標を開いて「鍵」の欄で決めてください。'),
      h('button', { class: 'btn primary', type: 'button', 'data-testid': 'pin-skip', onClick: () => { void setPinLater(ctx, onOpen); } }, '暗証番号を決めて開く'));
  });
  setTimeout(() => pin.focus(), 50);
  return root;
}

async function setPinLater(ctx: AppContext, onOpen: () => void): Promise<void> {
  const p = prompt('この iPhone の暗証番号（4〜8 桁の数字）');
  if (!p || !validPin(p)) { toast('4〜8 桁の数字にしてください'); return; }
  await setPin(ctx.store.db, p);
  onOpen();
}
