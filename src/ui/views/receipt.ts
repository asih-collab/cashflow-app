// レシートの読み取り（#/receipt、#/receipt?text=...）。
// 1. アプリ内のカメラで撮る（いちばん簡単）: 画像はこの端末の中だけで文字にし、保存しない（カメラロールにも残らない）
// 2. ショートカット / 写真の「テキスト認識」で取り出した文字を受け取る・貼り付ける（iPhone の文字認識。いちばん正確）
// どちらも、文字から合計・日付・お店・支払い方法を読み取り、確かめてから 1 件の記録として保存する。
import { h } from '../dom';
import { group, yen } from '../../lib/money';
import { parseReceipt, type ReceiptResult } from '../../lib/receipt';
import { guessCategory, guessPaymentMethod } from '../../lib/receiptGuess';
import { childrenOf, parentsOf } from '../../lib/categories';
import { toDateString } from '../../lib/period';
import type { AppContext, Route } from '../context';
import { icon } from '../icons';
import { toast } from '../toast';

const CONF_LABEL: Record<ReceiptResult['confidence'], string> = { high: '読み取り: 確か', medium: '読み取り: たぶん', low: '読み取り: 要確認' };

export function renderReceipt(ctx: AppContext, route: Route): HTMLElement {
  const root = h('div', { 'data-testid': 'receipt' },
    h('div', { class: 'row' }, h('a', { href: '#/add', style: 'display:inline-flex', 'aria-label': '戻る' }, icon('back')), h('h1', { class: 'grow', style: 'margin:0 0 0 8px' }, 'レシートから記録')),
  );
  const input = h('textarea', { class: 'input', rows: 6, placeholder: 'ここにレシートの文字を貼り付け', 'data-testid': 'receipt-text', style: 'min-height:120px;font-size:14px' });
  const result = h('div', { 'data-testid': 'receipt-result' });
  const show = (text: string, r: ReceiptResult, fromCamera: boolean) => {
    ctx.busy.entering = true;
    result.replaceChildren(renderForm(ctx, text, r, fromCamera ? retake : null));
    result.scrollIntoView({ behavior: 'smooth', block: 'start' });
  };
  const read = () => {
    const text = input.value.trim();
    if (!text) { toast('レシートの文字を貼り付けてください'); return; }
    show(text, parseReceipt(text), false);
  };

  // ---- アプリ内のカメラ ----
  const camera = h('input', { type: 'file', accept: 'image/*', capture: 'environment', hidden: true, 'data-testid': 'receipt-camera' });
  const library = h('input', { type: 'file', accept: 'image/*', hidden: true, 'data-testid': 'receipt-library' });
  const bar = h('i');
  const status = h('div', { class: 'small muted', 'data-testid': 'receipt-status' });
  const progress = h('div', { class: 'ocr-progress', hidden: true, 'data-testid': 'receipt-progress' }, h('div', { class: 'ocr-bar' }, bar), status);
  const shoot = h('button', { class: 'btn primary big', type: 'button', 'data-testid': 'receipt-shoot', onClick: () => camera.click() }, icon('receipt'), 'カメラで撮る');
  function retake(): void { camera.click(); }
  async function onImage(file: File | undefined): Promise<void> {
    if (!file) return;
    shoot.disabled = true;
    progress.hidden = false;
    result.replaceChildren();
    try {
      const { recognizeReceiptTwice } = await import('../../lib/ocr');
      const { primary, combined } = await recognizeReceiptTwice(file, (ratio, label) => {
        bar.style.width = `${Math.round(ratio * 100)}%`;
        status.textContent = label;
      });
      input.value = primary.trim();
      show(combined, parseReceipt(combined), true);
    } catch (e) {
      toast(`読み取れませんでした（${e instanceof Error ? e.message : String(e)}）。通信のよい所でもう一度試してください`, { durationMs: 7000 });
    } finally {
      shoot.disabled = false;
      progress.hidden = true;
      camera.value = '';
      library.value = '';
    }
  }
  camera.addEventListener('change', () => void onImage(camera.files?.[0]));
  library.addEventListener('change', () => void onImage(library.files?.[0]));

  const pasteBtn = h('button', { class: 'btn', type: 'button', 'data-testid': 'receipt-paste', onClick: async () => {
    try {
      input.value = await navigator.clipboard.readText();
      read();
    } catch {
      toast('貼り付けできませんでした。下の欄を長押しして「ペースト」してください');
      input.focus();
    }
  } }, '貼り付けて読み取る');
  const readBtn = h('button', { class: 'btn primary', type: 'button', 'data-testid': 'receipt-read', onClick: read }, '読み取る');

  root.append(
    camera, library,
    shoot,
    h('div', { class: 'small muted', style: 'margin:8px 2px 4px;line-height:1.7' },
      'うまく読むコツ: 明るい所で、レシートを平らにして画面いっぱいに、真上からまっすぐ撮る。影や折り目がないほど正確です。撮った写真は保存されません。'),
    h('div', { class: 'row', style: 'gap:8px;margin:6px 0 12px' },
      h('button', { class: 'btn sm', type: 'button', 'data-testid': 'receipt-pick', onClick: () => library.click() }, '写真から選ぶ'),
    ),
    progress,
    result,
    h('details', { class: 'card', style: 'padding:12px 18px;margin-top:16px' },
      h('summary', { class: 'small' }, 'もっと正確に: iPhone の文字認識を使う'),
      h('p', { class: 'small muted', style: 'margin:8px 0' }, 'iPhone の文字認識はアプリ内のカメラより正確です。ショートカット「レシートを記録」（作り方は「使い方」。撮った写真はカメラロールに残りません）か、写真の「テキスト認識」で文字をコピーして、ここに貼り付けます。'),
      h('div', { class: 'row', style: 'gap:8px;margin:4px 0 8px' }, pasteBtn),
      input,
      h('div', { class: 'row', style: 'justify-content:flex-end;margin:8px 0 4px' }, readBtn),
    ),
  );
  const fromShortcut = route.params.get('text');
  if (fromShortcut) {
    // 自動では保存しない（確かめて保存）ので、URL に文字が残っていても二重にはならない。同じ内容は二重の注意が出る
    input.value = fromShortcut;
    queueMicrotask(read);
  }
  return root;
}

function renderForm(ctx: AppContext, text: string, r: ReceiptResult, retake: (() => void) | null): HTMLElement {
  const { store } = ctx;
  const today = toDateString(new Date());
  const guessCat = guessCategory(r.store, text, store.categories, store.transactions);
  const guessPm = guessPaymentMethod(r.payment, store.paymentMethods);

  const amountIn = h('input', { class: 'input big-input', type: 'text', inputmode: 'numeric', value: r.total ? group(r.total) : '', placeholder: '0', 'data-testid': 'receipt-amount' });
  const dateIn = h('input', { class: 'input', type: 'date', value: r.date ?? today, 'data-testid': 'receipt-date' });
  const memoIn = h('input', { class: 'input', type: 'text', value: r.store ?? '', placeholder: 'お店（メモ）', 'data-testid': 'receipt-store', autocomplete: 'off' });
  const catIn = h('select', { class: 'input', 'data-testid': 'receipt-category' }, h('option', { value: '' }, '選んでください'));
  for (const p of parentsOf(store.categories).filter((x) => x.kind !== 'income')) {
    const kids = childrenOf(store.categories, p.id).filter((c) => c.is_active);
    if (kids.length === 0) continue;
    catIn.appendChild(h('optgroup', { label: p.name }, kids.map((c) => h('option', { value: c.id, selected: guessCat?.id === c.id }, c.name))));
  }
  const pmIn = h('select', { class: 'input', 'data-testid': 'receipt-pm' }, h('option', { value: '' }, '指定しない'));
  const pmDefault = guessPm?.id ?? store.defaultPaymentMethodId;
  for (const p of store.activePaymentMethods) pmIn.appendChild(h('option', { value: p.id, selected: p.id === pmDefault }, p.name));
  amountIn.addEventListener('blur', () => { const v = Number(amountIn.value.replace(/[^\d]/g, '')); amountIn.value = v ? group(v) : ''; checkDup(); });
  dateIn.addEventListener('change', () => checkDup());

  const dup = h('div', { class: 'banner', hidden: true, 'data-testid': 'receipt-dup' });
  function checkDup(): void {
    const v = Number(amountIn.value.replace(/[^\d]/g, ''));
    const same = store.liveTransactions.find((t) => t.date === dateIn.value && t.amount === v && t.type === 'expense');
    dup.hidden = !same;
    if (same) dup.textContent = `同じ日に同じ金額（${yen(v)}）の記録がすでにあります。二重にならないか確かめてください。`;
  }

  const others = r.candidates.filter((c) => c !== r.total).slice(0, 3);
  const card = h('div', { class: 'card', 'data-testid': 'receipt-form', style: 'margin-top:12px' },
    h('div', { class: `mono receipt-conf ${r.confidence}`, 'data-testid': 'receipt-conf' }, CONF_LABEL[r.confidence]),
    !r.total ? h('p', { class: 'small', style: 'margin:6px 0' }, '合計金額が読み取れませんでした。金額を入れてください。') : null,
    retake && r.confidence === 'low'
      ? h('div', { class: 'banner', 'data-testid': 'receipt-retake' }, '読み取りにくかったようです。明るい所で、レシートを画面いっぱいにまっすぐ撮り直すと、読み取りやすくなります。',
        h('div', { style: 'margin-top:8px' }, h('button', { class: 'btn sm primary', type: 'button', onClick: retake }, '撮り直す')))
      : null,
    h('label', { class: 'field' }, h('span', null, '合計金額（円）'), amountIn),
    others.length > 0 && r.confidence !== 'high'
      ? h('div', { class: 'row', style: 'gap:6px;flex-wrap:wrap;margin:-4px 0 10px' }, h('span', { class: 'muted small' }, 'ほかの候補:'),
        others.map((v) => h('button', { type: 'button', class: 'chip sm', 'data-testid': 'receipt-candidate', onClick: () => { amountIn.value = group(v); checkDup(); } }, yen(v))))
      : null,
    h('label', { class: 'field' }, h('span', null, r.date ? '日付' : '日付（読み取れなかったので今日）'), dateIn),
    h('label', { class: 'field' }, h('span', null, 'お店（メモに入ります）'), memoIn),
    h('label', { class: 'field' }, h('span', null, guessCat ? 'カテゴリ（お店から推測）' : 'カテゴリ'), catIn),
    h('label', { class: 'field' }, h('span', null, '支払い手段'), pmIn),
    dup,
    h('button', { class: 'btn primary big', type: 'button', 'data-testid': 'receipt-save', onClick: async () => {
      const amount = Number(amountIn.value.replace(/[^\d]/g, ''));
      if (amount <= 0) { toast('金額を入れてください'); amountIn.focus(); return; }
      if (!catIn.value) { toast('カテゴリを選んでください'); catIn.focus(); return; }
      const t = await store.addTransaction({
        amount, categoryId: catIn.value, date: dateIn.value || today, paymentMethodId: pmIn.value || null,
        memo: memoIn.value.trim(), source: 'receipt',
      });
      await store.recordReceiptOutcome({ saved: true, amountOk: amount === r.total, dateOk: t.date === (r.date ?? today), categoryOk: catIn.value === guessCat?.id });
      ctx.busy.entering = false;
      const cat = store.categories.find((c) => c.id === t.category_id);
      toast(`${cat?.name ?? ''} ${yen(amount)}${memoIn.value ? `（${memoIn.value.trim()}）` : ''} を記録しました`, { actionLabel: '取り消す', durationMs: 5000, onAction: () => void store.deleteTransaction(t.id) });
      ctx.navigate('/');
    } }, '確かめて保存'),
  );
  checkDup();
  void store.recordReceiptOutcome({ saved: false, amountOk: false, dateOk: false, categoryOk: false });
  return card;
}
