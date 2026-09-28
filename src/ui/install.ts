// 「ホーム画面に追加」の案内（05 の 5 章: ホーム画面追加が通知の前提）

export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || (typeof matchMedia === 'function' && matchMedia('(display-mode: standalone)').matches);
}

export function isIOS(): boolean {
  const ua = navigator.userAgent;
  return /iPhone|iPad|iPod/.test(ua) || (ua.includes('Mac') && 'ontouchend' in document);
}

export const INSTALL_STEPS = [
  'Safari の画面下にある「共有」ボタン（四角から矢印が出ているマーク）を押す',
  '出てきたメニューを下にスクロールして「ホーム画面に追加」を押す',
  '右上の「追加」を押す',
  'ホーム画面に「家計」のアイコンが増えるので、次からはそこから開く',
];
