import { expect, test } from './fixtures';
import { openApp, tapDigits } from './helpers';

/** 今月の n 日（YYYY-MM-DD） */
function dayOfThisMonth(n: number): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(n).padStart(2, '0')}`;
}

async function record(page: import('@playwright/test').Page, amount: string, cat: string) {
  await page.goto('./#/add');
  await expect(page.getByTestId('cat-デート')).toBeVisible();
  await tapDigits(page, amount);
  await page.getByTestId(`cat-${cat}`).tap();
  await page.getByTestId('save').tap();
  await expect(page.getByTestId('home')).toBeVisible();
}

test.describe('段階 2: 予算・自動記録・サマリ・履歴', () => {
  test('予算を決めると、ホームに「あと使える額」と大分類ごとの残りが出る。80% を超えたら知らせる', async ({ page }) => {
    await openApp(page, '#/');
    await expect(page.getByTestId('budget-hint')).toBeVisible();
    await page.getByTestId('budget-hint').tap();
    await page.getByTestId('budget-交際費').fill('10000');
    await page.getByTestId('budget-交際費').press('Enter');
    await expect(page.getByTestId('budget-total')).toHaveText('¥10,000');
    await page.getByTestId('budget-食費').fill('20000');
    await page.getByTestId('budget-食費').blur();
    await expect(page.getByTestId('budget-total')).toHaveText('¥30,000');

    await record(page, '7000', 'デート');
    await expect(page.getByTestId('remaining')).toHaveText('¥23,000');
    await expect(page.getByTestId('budget-lines')).toContainText('交際費');
    await expect(page.getByTestId('budget-lines')).toContainText('¥3,000');

    await record(page, '1500', 'デート');
    await expect(page.getByTestId('toast').filter({ hasText: '注意' })).toContainText('交際費が予算の 85%');

    // 予算のない大分類はマイナスで、色を変えて出す（全体の残りからも引かれる）
    await record(page, '2000', '日用雑貨');
    await expect(page.getByTestId('budget-left-日用品')).toHaveText('−¥2,000');
    await expect(page.getByTestId('budget-left-日用品')).toHaveClass(/neg/);
    await expect(page.getByTestId('budget-left-交際費')).not.toHaveClass(/neg/);
    await expect(page.getByTestId('remaining')).toHaveText('¥19,500');
  });

  test('固定費と給料を登録すると今月分が 1 回だけ自動で記録され、サマリの収支に入る', async ({ page }) => {
    await openApp(page, '#/settings');
    await page.getByTestId('go-recurring').tap();
    await page.getByTestId('rule-add').tap();
    await page.getByTestId('rule-name').fill('家賃');
    await page.getByTestId('rule-amount').fill('100000');
    await page.getByTestId('rule-day').selectOption('27');
    await page.getByTestId('rule-category').selectOption({ label: '家賃' });
    await page.getByTestId('rule-save').tap();
    await expect(page.getByTestId('rule-家賃')).toContainText('¥100,000');

    await page.getByTestId('rule-add').tap();
    await page.getByTestId('rule-income').tap();
    await page.getByTestId('rule-name').fill('給料');
    await page.getByTestId('rule-amount').fill('300000');
    await page.getByTestId('rule-day').selectOption('25');
    await page.getByTestId('rule-category').selectOption({ label: '給与' });
    await page.getByTestId('rule-save').tap();
    await expect(page.getByTestId('rule-給料')).toContainText('+¥300,000');

    // 開き直しても二重にならない。カレンダーの 27 日・25 日に出る
    await page.reload();
    await page.goto('./#/history');
    await page.getByTestId(`cal-${dayOfThisMonth(27)}`).tap();
    await expect(page.getByTestId('history-row')).toHaveCount(1);
    await expect(page.getByTestId('history-row')).toContainText('家賃');
    await expect(page.getByTestId(`cal-${dayOfThisMonth(27)}`)).toContainText('10万');
    await page.getByTestId(`cal-${dayOfThisMonth(25)}`).tap();
    await expect(page.getByTestId('history-row')).toHaveCount(1);
    await expect(page.getByTestId('day-net')).toHaveText('+¥300,000');

    await record(page, '5000', 'デート');
    await page.goto('./#/summary');
    await expect(page.getByTestId('sum-income')).toHaveText('+¥300,000');
    await expect(page.getByTestId('sum-expense')).toHaveText('¥105,000');
    await expect(page.getByTestId('balance')).toHaveText('+¥195,000');
    await expect(page.getByTestId('balance-card')).toContainText('黒字');
    // 変動費の合計（ホーム）には固定費は入らない
    await page.goto('./#/');
    await expect(page.getByTestId('variable-total')).toHaveText('¥5,000');
  });

  test('ルールの金額を直すと、手で直していない今月分の記録も合わせて変わる。やめても記録は残る', async ({ page }) => {
    await openApp(page, '#/recurring?id=new');
    await page.getByTestId('rule-name').fill('携帯');
    await page.getByTestId('rule-amount').fill('8000');
    await page.getByTestId('rule-category').selectOption({ label: '携帯' });
    await page.getByTestId('rule-save').tap();
    await expect(page.getByTestId('rule-list')).toBeVisible();
    await page.getByTestId('rule-携帯').tap();
    await page.getByTestId('rule-amount').fill('9000');
    await page.getByTestId('rule-save').tap();
    await expect(page.getByTestId('rule-携帯')).toContainText('¥9,000');
    await page.goto('./#/history');
    await page.getByTestId(`cal-${dayOfThisMonth(1)}`).tap();
    await expect(page.getByTestId('history-row')).toHaveCount(1);
    await expect(page.getByTestId('history-row')).toContainText('¥9,000');
    await page.goto('./#/recurring');
    await page.getByTestId('rule-携帯').tap();
    page.once('dialog', (d) => d.accept());
    await page.getByTestId('rule-delete').tap();
    await expect(page.getByTestId('rule-list')).not.toContainText('携帯');
    await page.goto('./#/history');
    await page.getByTestId(`cal-${dayOfThisMonth(1)}`).tap();
    await expect(page.getByTestId('history-row')).toHaveCount(1);
  });

  test('履歴カレンダー: 前の月の日付を押して追加し、カレンダーに戻る。記録を直せる。前月比も出る', async ({ page }) => {
    await openApp(page, '#/history');
    const nowLabel = await page.getByTestId('month-label').textContent();
    await page.getByTestId('month-prev').tap();
    await expect(page.getByTestId('month-label')).not.toHaveText(nowLabel!);
    const label = await page.getByTestId('month-label').textContent();
    // 前の月の 10 日を押して、その日に追加
    const cell = page.locator('[data-testid^="cal-"][data-date$="-10"]');
    const date = await cell.getAttribute('data-date');
    await cell.tap();
    await expect(page.getByTestId('day-detail')).toContainText('この日の記録はありません');
    await page.getByTestId('history-add').tap();
    await tapDigits(page, '4000');
    await page.getByTestId('cat-外食').tap();
    await page.getByTestId('save').tap();

    // 保存するとカレンダーの同じ日に戻り、マスに収支が出る
    await expect(page.getByTestId('history')).toBeVisible();
    await expect(page.getByTestId('month-label')).toHaveText(label!);
    await expect(page.getByTestId(`cal-${date}`)).toContainText('4,000');
    await expect(page.getByTestId('day-net')).toHaveText('−¥4,000');
    await expect(page.getByTestId('cal-expense')).toHaveText('¥4,000');

    // 記録を押して直すと、同じ日に戻る
    await page.getByTestId('history-row').tap();
    await tapDigits(page, '4500');
    await page.getByTestId('save').tap();
    await expect(page.getByTestId('history')).toBeVisible();
    await expect(page.getByTestId('history-row')).toContainText('¥4,500');

    // 収入も追加できる
    await page.getByTestId('history-add-income').tap();
    await tapDigits(page, '10000');
    await page.getByTestId('cat-臨時収入').tap();
    await page.getByTestId('save').tap();
    await expect(page.getByTestId('history')).toBeVisible();
    await expect(page.getByTestId('day-net')).toHaveText('+¥5,500');
    await expect(page.getByTestId(`cal-${date}`)).toContainText('+5,500');

    // 今月 3,000 使うと、サマリの外食（食費）に前月比が出る
    await record(page, '3000', '外食');
    await page.goto('./#/summary');
    await expect(page.getByTestId('sum-groups')).toContainText('食費');
    await expect(page.getByTestId('sum-groups')).toContainText('前月比 −¥1,500');
  });

  test('前の月の予算をコピーできる', async ({ page }) => {
    await openApp(page, '#/budget');
    const now = await page.getByTestId('month-label').textContent();
    await page.getByTestId('month-prev').tap();
    await expect(page.getByTestId('month-label')).not.toHaveText(now!);
    await page.getByTestId('budget-交際費').fill('12000');
    await page.getByTestId('budget-交際費').blur();
    await expect(page.getByTestId('budget-total')).toHaveText('¥12,000');
    await page.getByTestId('month-next').tap();
    await expect(page.getByTestId('month-label')).toHaveText(now!);
    await page.getByTestId('budget-copy').tap();
    await expect(page.getByTestId('budget-交際費')).toHaveValue('12,000');
    await expect(page.getByTestId('budget-total')).toHaveText('¥12,000');
  });

  test('サマリ: カテゴリを押すと中分類と記録が開き、記録から修正できる。内訳の種別からカテゴリへ移れる', async ({ page }) => {
    await openApp(page, '#/');
    await record(page, '1200', '外食');
    await record(page, '450', 'コンビニ');
    await record(page, '800', '外食');
    await page.goto('./#/summary');
    await expect(page.getByTestId('sum-detail-食費')).toBeHidden();
    await page.getByTestId('sum-group-食費').tap();
    const detail = page.getByTestId('sum-detail-食費');
    await expect(detail).toBeVisible();
    await expect(detail.getByTestId('sub-row').first()).toContainText('外食');
    await expect(detail.getByTestId('sub-row').first()).toContainText('¥2,000');
    await expect(detail.getByTestId('sub-row').first()).toContainText('2 件');
    await expect(detail.getByTestId('detail-item')).toHaveCount(3);
    // もう一度押すと閉じる
    await page.getByTestId('sum-group-食費').tap();
    await expect(detail).toBeHidden();

    // 内訳（変動費）を開き、食費を押すとカテゴリの詳細が開く
    await page.getByTestId('mix-variable').tap();
    await expect(page.getByTestId('mix-detail-variable')).toContainText('食費');
    await page.getByTestId('mix-detail-variable').getByRole('button', { name: /食費/ }).tap();
    await expect(detail).toBeVisible();

    // 記録を押すと修正画面
    await detail.getByTestId('detail-item').first().tap();
    await expect(page.getByTestId('edit-delete')).toBeVisible();
  });

  test('履歴の一覧: 月の記録が日付順に並び、日ごとの収支と累計が出る。絞り込み・修正ができ、表示の切り替えは覚えておく', async ({ page }) => {
    await openApp(page, '#/add');
    await page.getByTestId('mode-income').tap();
    await tapDigits(page, '300000');
    await page.getByTestId('cat-給与').tap();
    await page.getByTestId('save').tap();
    await expect(page.getByTestId('home')).toBeVisible();
    await record(page, '1200', '外食');
    await record(page, '800', 'カフェ');

    await page.goto('./#/history');
    await page.getByTestId('view-list').tap();
    await expect(page.getByTestId('ledger')).toBeVisible();
    await expect(page.getByTestId('ledger-row')).toHaveCount(3);
    await expect(page.getByTestId('ledger-row').first()).toContainText('+¥300,000');
    await expect(page.getByTestId('ledger-running').last()).toHaveText('累計 +¥298,000');

    await page.getByTestId('ledger-filter-expense').tap();
    await expect(page.getByTestId('ledger-row')).toHaveCount(2);
    await expect(page.getByTestId('ledger-row').first()).toContainText('−¥1,200');

    // 記録を押して直すと一覧に戻る
    await page.getByTestId('ledger-row').first().tap();
    await tapDigits(page, '1500');
    await page.getByTestId('save').tap();
    await expect(page.getByTestId('ledger')).toBeVisible();
    await expect(page.getByTestId('ledger-row').first()).toContainText('−¥1,500');

    // 次に開いたときも一覧のまま。カレンダーに戻せる
    await page.goto('./#/');
    await page.goto('./#/history');
    await expect(page.getByTestId('ledger')).toBeVisible();
    await page.getByTestId('view-cal').tap();
    await expect(page.getByTestId('calendar')).toBeVisible();
  });

  test('履歴の一覧は新しい日が上。累計は月初からの日付順の値', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-11-10T12:00:00+09:00') });
    await openApp(page, '#/add?date=2026-11-02');
    await tapDigits(page, '1000');
    await page.getByTestId('cat-外食').tap();
    await page.getByTestId('save').tap();
    await expect(page.getByTestId('home')).toBeVisible();
    await record(page, '500', 'カフェ');
    await page.goto('./#/history?v=list');
    const days = page.locator('[data-testid^="ledger-2026"]');
    await expect(days).toHaveCount(2);
    await expect(days.first()).toHaveAttribute('data-testid', 'ledger-2026-11-10');
    await expect(days.first().getByTestId('ledger-running')).toHaveText('累計 −¥1,500');
    await expect(days.last().getByTestId('ledger-running')).toHaveText('累計 −¥1,000');
  });
});

