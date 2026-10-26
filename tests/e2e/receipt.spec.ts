import { expect, test } from './fixtures';
import { openApp } from './helpers';

const SEVEN = `セブン-イレブン 渋谷店
${new Date().getFullYear()}年${new Date().getMonth() + 1}月${new Date().getDate()}日 12:34
おにぎり ¥160
お茶 ¥140
合計 ¥300
PayPay ¥300`;

test.describe('レシートから記録', () => {
  test('ショートカットから文字を受け取ると、合計・日付・お店・カテゴリ・支払い手段が入り、確かめて保存できる', async ({ page }) => {
    await openApp(page, `#/receipt?text=${encodeURIComponent(SEVEN)}`);
    await expect(page.getByTestId('receipt-form')).toBeVisible();
    await expect(page.getByTestId('receipt-amount')).toHaveValue('300');
    await expect(page.getByTestId('receipt-store')).toHaveValue('セブン-イレブン');
    expect(await page.getByTestId('receipt-category').locator('option:checked').textContent()).toBe('コンビニ');
    expect(await page.getByTestId('receipt-pm').locator('option:checked').textContent()).toBe('PayPay');
    await expect(page.getByTestId('receipt-conf')).toContainText('確か');
    await page.getByTestId('receipt-save').tap();
    await expect(page.getByTestId('home')).toBeVisible();
    await expect(page.getByTestId('recent-row').first()).toContainText('コンビニ');
    await expect(page.getByTestId('recent-row').first()).toContainText('セブン-イレブン');
    // 同じ文字をもう一度読むと、二重の記録に注意が出る
    await page.goto(`./#/receipt?text=${encodeURIComponent(SEVEN)}`);
    await expect(page.getByTestId('receipt-dup')).toBeVisible();
    // 設定に成績が出る
    await page.goto('./#/settings');
    await expect(page.getByTestId('receipt-stats')).toContainText('保存 1 件');
    await expect(page.getByTestId('receipt-stats')).toContainText('金額 100%');
  });

  test('記録画面の「レシート」から開き、貼り付けた文字を読み取る。自信がなければ候補から選べ、カテゴリを選んで保存する', async ({ page }) => {
    await openApp(page, '#/add');
    await page.getByTestId('go-receipt').tap();
    await expect(page.getByTestId('receipt')).toBeVisible();
    await page.getByText('もっと正確に').tap();
    await page.getByTestId('receipt-text').fill('パン工房 こむぎ\nクロワッサン ¥220\nカレーパン ¥260\n¥1,000');
    await page.getByTestId('receipt-read').tap();
    await expect(page.getByTestId('receipt-conf')).not.toContainText('確か');
    await page.getByTestId('receipt-candidate').first().waitFor();
    await page.getByTestId('receipt-amount').fill('480');
    await page.getByTestId('receipt-save').tap();
    await expect(page.getByTestId('toast')).toContainText('カテゴリを選んでください');
    await page.getByTestId('receipt-category').selectOption({ label: '食料品' });
    await page.getByTestId('receipt-save').tap();
    await expect(page.getByTestId('home')).toBeVisible();
    await expect(page.getByTestId('variable-total')).toHaveText('¥480');
  });

  test('アプリ内のカメラ: 撮った画像をこの端末の中で読み取り、合計とお店が入る（画像は保存しない）', async ({ page, browser }) => {
    test.setTimeout(90_000);
    // レシートの画像を作る（別のページで描いて撮る）
    const p2 = await browser.newPage({ viewport: { width: 480, height: 800 }, deviceScaleFactor: 3 });
    await p2.setContent(`<div id="r" style="width:380px;padding:24px;background:#fbfaf6;font:18px/1.5 IPAGothic,sans-serif;color:#222">
      <div>ローソン 新宿店</div><div>2026年10月20日 12:00</div>
      <div style="display:flex;justify-content:space-between"><span>おにぎり</span><span>¥160</span></div>
      <div style="display:flex;justify-content:space-between"><span>お茶</span><span>¥140</span></div>
      <div style="display:flex;justify-content:space-between"><span>合計</span><span>¥300</span></div>
      <div style="display:flex;justify-content:space-between"><span>お預り</span><span>¥1,000</span></div>
      <div style="display:flex;justify-content:space-between"><span>お釣り</span><span>¥700</span></div></div>`);
    const image = await p2.locator('#r').screenshot({ type: 'jpeg', quality: 80 });
    await p2.close();

    await page.clock.install({ time: new Date('2026-10-26T12:00:00+09:00') });
    await openApp(page, '#/receipt');
    await page.getByTestId('receipt-camera').setInputFiles({ name: 'r.jpg', mimeType: 'image/jpeg', buffer: image });
    await expect(page.getByTestId('receipt-form')).toBeVisible({ timeout: 60_000 });
    await expect(page.getByTestId('receipt-amount')).toHaveValue('300');
    await expect(page.getByTestId('receipt-store')).toHaveValue('ローソン');
    await expect(page.getByTestId('receipt-date')).toHaveValue('2026-10-20');
    expect(await page.getByTestId('receipt-category').locator('option:checked').textContent()).toBe('コンビニ');
  });
});

