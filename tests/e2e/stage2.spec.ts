import { expect, test } from './fixtures';
import { openApp, tapDigits } from './helpers';

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

    // 開き直しても二重にならない
    await page.reload();
    await page.goto('./#/history');
    await expect(page.getByTestId('history-row')).toHaveCount(2);

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
    await expect(page.getByTestId('history-row')).toHaveCount(1);
    await expect(page.getByTestId('history-row')).toContainText('¥9,000');
    await page.goto('./#/recurring');
    await page.getByTestId('rule-携帯').tap();
    page.once('dialog', (d) => d.accept());
    await page.getByTestId('rule-delete').tap();
    await expect(page.getByTestId('rule-list')).not.toContainText('携帯');
    await page.goto('./#/history');
    await expect(page.getByTestId('history-row')).toHaveCount(1);
  });

  test('履歴: 前の月に移動して過去の日付で追加し、修正できる。前月比も出る', async ({ page }) => {
    await openApp(page, '#/history');
    const nowLabel = await page.getByTestId('month-label').textContent();
    await page.getByTestId('month-prev').tap();
    await expect(page.getByTestId('month-label')).not.toHaveText(nowLabel!);
    const label = await page.getByTestId('month-label').textContent();
    await page.getByTestId('history-add').tap();
    await tapDigits(page, '4000');
    await page.getByTestId('cat-外食').tap();
    await page.getByTestId('save').tap();
    await expect(page.getByTestId('home')).toBeVisible();

    await page.goto('./#/history');
    await page.getByTestId('month-prev').tap();
    await expect(page.getByTestId('month-label')).toHaveText(label!);
    await expect(page.getByTestId('history-row')).toHaveCount(1);
    await page.getByTestId('history-row').tap();
    await tapDigits(page, '4500');
    await page.getByTestId('save').tap();
    await expect(page.getByTestId('history')).toBeVisible();
    await page.goto('./#/history');
    await page.getByTestId('month-prev').tap();
    await expect(page.getByTestId('history-row')).toContainText('¥4,500');

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
});
