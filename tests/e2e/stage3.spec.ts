import { expect, test } from './fixtures';
import { openApp } from './helpers';

test.describe('段階 3: リボ残高・ショートカット・通知', () => {
  test('リボ残高: カードを登録すると完済見込みと上乗せの効果が出て、残高を更新すると推移が残る。ホームにも出る', async ({ page }) => {
    await openApp(page, '#/settings');
    await page.getByTestId('go-debts').tap();
    await expect(page.getByTestId('debts')).toBeVisible();
    await page.getByTestId('debt-add').tap();
    await page.getByTestId('debt-name').fill('カードA');
    await page.getByTestId('debt-balance').fill('300000');
    await page.getByTestId('debt-monthly').fill('30000');
    await page.getByTestId('debt-save').tap();

    await expect(page.getByTestId('debt-total')).toHaveText('¥300,000');
    await expect(page.getByTestId('debt-payoff')).toContainText('年');
    await expect(page.getByTestId('debt-yearly-fee')).toHaveText('¥45,000'); // 300,000 × 15% ÷ 12 × 12
    await expect(page.getByTestId('debt-extra-msg')).toContainText('か月早く');
    await page.getByTestId('debt-extra-30000').tap();
    await expect(page.getByTestId('debt-extra-msg')).toContainText('¥30,000 多く返すと');
    await expect(page.getByTestId('debt-chart').locator('svg path.line')).toHaveCount(2);

    // 2 枚目（返済額が手数料以下）→ 終わらない警告
    await page.getByTestId('debt-add').tap();
    await page.getByTestId('debt-name').fill('カードB');
    await page.getByTestId('debt-balance').fill('1000000');
    await page.getByTestId('debt-monthly').fill('10000');
    await page.getByTestId('debt-save').tap();
    await expect(page.getByTestId('debt-total')).toHaveText('¥1,300,000');
    await expect(page.getByTestId('debt-payoff')).toHaveText('終わらない');

    // 残高を更新（別の日付）→ 推移が 2 件
    await page.getByTestId('debt-カードA').tap();
    await page.getByTestId('debt-balance').fill('270000');
    await page.getByTestId('debt-date').fill('2099-01-01');
    await page.getByTestId('debt-save').tap();
    await page.getByTestId('debt-カードA').tap();
    await expect(page.getByTestId('debt-history').locator('.list-item')).toHaveCount(2);
    await page.goto('./#/');
    await expect(page.getByTestId('home-debt')).toContainText('¥1,270,000');
    // サマリにも出る。毎月の返済のうち手数料（270,000 × 15% ÷ 12 = 3,375 と 1,000,000 × 15% ÷ 12 = 12,500）
    await page.goto('./#/summary');
    await expect(page.getByTestId('sum-debt-total')).toHaveText('¥1,270,000');
    await expect(page.getByTestId('sum-debt-fee')).toHaveText('¥15,875');
  });

  test('リボ残高: 固定費の自動記録（リボ・分割返済）と返済額の合計が違えば知らせ、合わせられる', async ({ page }) => {
    await openApp(page, '#/recurring?id=new');
    await page.getByTestId('rule-name').fill('リボ返済');
    await page.getByTestId('rule-amount').fill('50000');
    await page.getByTestId('rule-category').selectOption({ label: 'リボ・分割返済' });
    await page.getByTestId('rule-save').tap();
    // 保存が終わって一覧に戻ってから次へ（先に移ると、保存後の画面移動で上書きされる）
    await expect(page.getByTestId('rule-リボ返済')).toBeVisible();
    await page.goto('./#/debts?id=new');
    await page.getByTestId('debt-name').fill('カードA');
    await page.getByTestId('debt-balance').fill('300000');
    await page.getByTestId('debt-monthly').fill('30000');
    await page.getByTestId('debt-save').tap();
    await expect(page.getByTestId('debt-rule-mismatch')).toContainText('¥50,000');
    await page.getByTestId('debt-rule-align').tap();
    await expect(page.getByTestId('debt-rule-ok')).toContainText('¥30,000');
    await page.goto('./#/recurring');
    await expect(page.getByTestId('rule-リボ返済')).toContainText('¥30,000');
  });

  test('一括返済: 予定を入れると見込みに反映され、その月になるとホームに案内が出て「返した」で記録と残高が更新される', async ({ page }) => {
    await openApp(page, '#/debts?id=new');
    await page.getByTestId('debt-name').fill('カードA');
    await page.getByTestId('debt-balance').fill('900000');
    await page.getByTestId('debt-monthly').fill('30000');
    await page.getByTestId('debt-save').tap();
    const before = await page.getByTestId('debt-payoff').textContent();

    // 先の月の予定 → 見込みが早まる
    await page.getByTestId('debt-カードA').tap();
    await page.getByTestId('lump-month').fill('2099-12');
    await page.getByTestId('lump-amount').fill('300000');
    await page.getByTestId('lump-add').tap();
    await expect(page.getByTestId('lump-2099-12')).toContainText('¥300,000');
    await page.goto('./#/debts');
    await expect(page.getByTestId('debt-lump-effect')).toContainText('カードA へ ¥300,000');
    await page.getByTestId('debt-カードA').tap();
    await page.getByTestId('lump-remove-2099-12').tap();
    await expect(page.getByTestId('lump-2099-12')).toHaveCount(0);

    // 今月の予定 → ホームに案内
    const month = await page.evaluate(() => { const d = new Date(); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; });
    await page.getByTestId('lump-month').fill(month);
    await page.getByTestId('lump-amount').fill('300000');
    await page.getByTestId('lump-add').tap();
    await expect(page.getByTestId(`lump-${month}`)).toBeVisible();
    await page.goto('./#/debts');
    expect(await page.getByTestId('debt-payoff').textContent()).not.toBe(before);
    await page.goto('./#/');
    await expect(page.getByTestId('lump-due')).toContainText('カードA に ¥300,000');
    page.once('dialog', (d) => void d.accept());
    await page.getByTestId('lump-done').tap();
    await expect(page.getByTestId('lump-due')).toHaveCount(0);
    await expect(page.getByTestId('home-debt-total')).toHaveText('¥600,000');
    await expect(page.getByTestId('recent-row').first()).toContainText('リボ・分割返済');
  });

  test('ショートカット: #/add?amount=&cat=&save=1 で開くとそのまま保存され、開き直しても二重にならない', async ({ page }) => {
    await openApp(page, '#/add?amount=1200&cat=デート&save=1');
    await expect(page.getByTestId('toast')).toContainText('デート ¥1,200 を記録');
    await expect(page.getByTestId('home')).toBeVisible();
    await expect(page.getByTestId('variable-total')).toHaveText('¥1,200');
    await page.goBack().catch(() => {});
    await page.reload();
    await page.goto('./#/');
    await expect(page.getByTestId('variable-total')).toHaveText('¥1,200');
    await expect(page.getByTestId('recent-row')).toHaveCount(1);
  });

  test('ショートカット: 予算がある大分類なら保存後に「残り」を出す', async ({ page }) => {
    await openApp(page, '#/budget');
    await page.getByTestId('budget-交際費').fill('30000');
    await page.getByTestId('budget-交際費').blur();
    await page.goto('./#/add?amount=2000&cat=デート&save=1');
    await expect(page.getByTestId('toast').filter({ hasText: 'デート ¥2,000' })).toContainText('交際費 残り ¥28,000');
  });

  test('通知: iPhone の Safari（ホーム画面に追加していない）では追加の案内を出す', async ({ page }) => {
    await openApp(page, '#/settings');
    await expect(page.getByTestId('push-card')).toContainText('ホーム画面に追加');
  });
});
