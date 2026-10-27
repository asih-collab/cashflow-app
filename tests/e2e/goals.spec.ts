import { expect, test } from './fixtures';
import { openApp, tapDigits } from './helpers';

test.describe('貯金の目標と節約のチャレンジ', () => {
  test('目標を作り、当てにする資産・入金の予定・増やす予定を入れると、ホームに進み具合と達成見込みが出る', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-27T12:00:00+09:00') });
    await openApp(page, '#/settings');
    await page.getByTestId('go-goals').tap();
    await page.getByTestId('goal-add').tap();
    await page.getByTestId('goal-name').fill('旅行資金');
    await page.getByTestId('goal-target').fill('1000000');
    await page.getByTestId('goal-monthly').fill('50000');
    await page.getByTestId('goal-save').tap();
    await expect(page.getByTestId('goal-form')).toBeVisible();
    await expect(page.getByTestId('goal-rules')).toContainText('¥50,000');
    await expect(page.getByTestId('goal-rules')).toContainText('2026年11月から');

    for (const [i, m] of ['2026-12', '2027-06', '2027-12'].entries()) {
      await page.getByTestId('extra-month').fill(m);
      await page.getByTestId('extra-amount').fill('100000');
      await page.getByTestId('goal-extras-add').tap();
      await expect(page.getByTestId(`goal-extras-${i}`)).toBeVisible();
    }
    await expect(page.getByTestId('goal-detail-reach')).toContainText('達成見込み 2027年12月');
    await page.getByTestId('asset-name').fill('預金');
    await page.getByTestId('asset-amount').fill('300000');
    await page.getByTestId('goal-assets-add').tap();
    await expect(page.getByTestId('goal-detail-total')).toContainText('¥300,000');
    await expect(page.getByTestId('goal-detail-reach')).toContainText('達成見込み 2027年8月');

    await page.goto('./#/');
    await expect(page.getByTestId('home-goal')).toContainText('旅行資金');
    await expect(page.getByTestId('home-goal-reach')).toContainText('2027年8月');
  });

  test('チャレンジ: 飲み会は月 2 回まで → 記録画面で保存前に「2 / 2 回 上限」、超えたらホームと今日の気づきで注意', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-27T12:00:00+09:00') });
    await openApp(page, '#/goals?ch=new');
    await page.getByTestId('challenge-name').fill('飲み会は月2回まで');
    await page.getByTestId('challenge-limit').fill('2');
    await page.getByTestId('challenge-cat-飲み会').tap();
    await page.getByTestId('challenge-save').tap();
    await expect(page.getByTestId('challenge-list')).toContainText('0 / 2 回');

    const drink = async (amount: string) => {
      await page.goto('./#/add');
      await page.getByTestId('cat-more').tap();
      await page.getByTestId('all-cat-飲み会').tap();
      await tapDigits(page, amount);
    };
    await drink('5000');
    await page.getByTestId('save').tap();
    await expect(page.getByTestId('home')).toBeVisible();
    await drink('5000');
    await expect(page.getByTestId('pre-spend')).toContainText('2 / 2 回 上限');
    await page.getByTestId('save').tap();
    await expect(page.getByTestId('home')).toBeVisible();
    await drink('3000');
    await expect(page.getByTestId('pre-spend')).toContainText('3 / 2 回 超過');
    await page.getByTestId('save').tap();
    await expect(page.getByTestId('home-challenges')).toContainText('3 / 2 回 超過');
    await expect(page.getByTestId('home-daily')).toContainText('上限を超えています');
  });

  test('使う前に見せる: 予算の残り（前 → 後）と、手取りで何時間分', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-27T12:00:00+09:00') });
    await openApp(page, '#/recurring?id=new');
    await page.getByTestId('rule-income').tap();
    await page.getByTestId('rule-name').fill('給料');
    await page.getByTestId('rule-amount').fill('480000'); // 3,000 円/時
    await page.getByTestId('rule-save').tap();
    await expect(page.getByTestId('rule-給料')).toBeVisible();
    await page.goto('./#/budget');
    await page.getByTestId('budget-食費').fill('60000');
    await page.getByTestId('budget-食費').blur();
    await page.goto('./#/add');
    await tapDigits(page, '9000');
    await page.getByTestId('cat-外食').tap();
    await expect(page.getByTestId('pre-spend')).toContainText('食費の残り ¥60,000 → ¥51,000');
    await expect(page.getByTestId('pre-spend')).toContainText('手取りで約 3 時間分');
  });

  test('鍵付きの目標: 暗証番号を決めて作ると、アプリを閉じた後はホーム・一覧・固定費に名前が出ず、暗証番号で開ける', async ({ page }) => {
    await page.clock.install({ time: new Date('2026-10-27T12:00:00+09:00') });
    await openApp(page, '#/goals?id=new');
    await page.getByTestId('goal-name').fill('サプライズ');
    await page.getByTestId('goal-target').fill('500000');
    await page.getByTestId('goal-monthly').fill('30000');
    await page.getByTestId('goal-private').check();
    await page.getByTestId('goal-alias').fill('貯金');
    await page.getByTestId('pin-new').fill('2468');
    await page.getByTestId('pin-new2').fill('2468');
    await page.getByTestId('goal-save').tap();
    await expect(page.getByTestId('goal-detail')).toContainText('サプライズ');
    await page.goto('./#/');
    await expect(page.getByTestId('home-goal')).toContainText('サプライズ');

    // アプリを裏に回す → 鍵が閉じる
    const setVisibility = (v: string) => page.evaluate((v) => {
      Object.defineProperty(document, 'visibilityState', { value: v, configurable: true });
      document.dispatchEvent(new Event('visibilitychange'));
    }, v);
    await setVisibility('hidden');
    await setVisibility('visible');
    await page.goto('./#/');
    await expect(page.getByTestId('home')).toBeVisible();
    await expect(page.getByTestId('home-goal')).toHaveCount(0);
    await expect(page.locator('body')).not.toContainText('サプライズ');
    await page.goto('./#/recurring');
    await expect(page.getByTestId('rule-list')).toContainText('貯金（先取り）');
    await expect(page.locator('body')).not.toContainText('サプライズ');
    await page.goto('./#/goals');
    await expect(page.getByTestId('goals-locked')).toContainText('鍵付きの目標 1 件');
    await expect(page.locator('body')).not.toContainText('サプライズ');

    // 開く
    await page.getByTestId('goals-unlock').tap();
    await page.getByTestId('pin').fill('1111');
    await page.getByTestId('pin-open').tap();
    await expect(page.getByTestId('toast')).toContainText('暗証番号が違います');
    await page.getByTestId('pin').fill('2468');
    await page.getByTestId('pin-open').tap();
    await expect(page.getByTestId('goals')).toContainText('サプライズ');
  });
});

