// レシートから読み取ったお店・支払い方法を、この人のカテゴリ・支払い手段に当てはめる。
// 1. 同じお店で前に記録したカテゴリ（メモがお店の名前と同じ記録）を最優先
// 2. なければ、お店の種類から決めた中分類（コンビニ・カフェ・外食…）
import type { Category, PaymentMethod, Transaction } from './types';
import type { ReceiptResult } from './receipt';

/** お店の名前 → 中分類の名前（初期カテゴリの名前） */
const STORE_TO_SUB: [RegExp, string][] = [
  [/セブン-イレブン|ファミリーマート|ローソン|ミニストップ|デイリーヤマザキ|NewDays/, 'コンビニ'],
  [/スターバックス|ドトール|タリーズ|コメダ|エクセルシオール|珈琲|コーヒー|カフェ|CAFE|COFFEE/i, 'カフェ'],
  [/マクドナルド|モスバーガー|すき家|吉野家|松屋|なか卯|サイゼリヤ|ガスト|丸亀製麺|大戸屋|スシロー|くら寿司|はま寿司|CoCo壱番屋|レストラン|食堂|ラーメン|そば|うどん|寿司|定食/, '外食'],
  [/鳥貴族|居酒屋|酒場|バー\b|BAR\b/i, '飲み会'],
  [/イオン|イトーヨーカドー|西友|ライフ|まいばすけっと|オーケー|成城石井|サミット|マルエツ|東急ストア|ヤオコー|ベルク|業務スーパー|スーパー|パン|ベーカリー|精肉|青果|鮮魚/, '食料品'],
  [/マツモトキヨシ|ウエルシア|スギ薬局|ツルハ|サンドラッグ|ココカラファイン|トモズ|ドラッグ|ダイソー|セリア|キャンドゥ|無印良品|ニトリ|ホームセンター/, '日用雑貨'],
  [/ユニクロ|GU|ZARA|しまむら/, '衣服'],
  [/ヨドバシカメラ|ビックカメラ|ヤマダ電機|ケーズデンキ|エディオン/, '家電'],
  [/書店|紀伊國屋|TSUTAYA|ブックオフ/, '書籍'],
  [/ENEOS|出光|コスモ石油|ガソリン/, 'ガソリン'],
  [/タクシー|交通|運賃/, 'タクシー'],
  [/薬局|クリニック|病院|医院|歯科/, '病院'],
];

export function guessCategory(store: string | null, text: string, categories: Category[], transactions: Transaction[]): Category | null {
  const live = categories.filter((c) => c.parent_id && c.is_active && !c.deleted_at && c.kind !== 'income');
  if (store) {
    // 同じお店の、いちばん新しい記録のカテゴリ
    const past = transactions
      .filter((t) => !t.deleted_at && t.type === 'expense' && t.memo && (t.memo === store || t.memo.startsWith(store)))
      .sort((a, b) => b.created_at.localeCompare(a.created_at))[0];
    const learned = past && live.find((c) => c.id === past.category_id);
    if (learned) return learned;
  }
  const hay = `${store ?? ''}\n${text}`;
  for (const [re, name] of STORE_TO_SUB) {
    if (re.test(store ?? '') || (name === 'タクシー' && re.test(hay))) {
      const c = live.find((x) => x.name === name);
      if (c) return c;
    }
  }
  return null;
}

export function guessPaymentMethod(payment: ReceiptResult['payment'], methods: PaymentMethod[]): PaymentMethod | null {
  const active = methods.filter((m) => m.is_active && !m.deleted_at);
  switch (payment) {
    case 'paypay': return active.find((m) => /paypay|ペイペイ/i.test(m.name)) ?? active.find((m) => m.type === 'qr') ?? null;
    case 'ic': return active.find((m) => /suica|pasmo|icoca|交通|ic|id|quicpay|waon|nanaco|edy/i.test(m.name)) ?? null;
    case 'card': return active.find((m) => m.type === 'card') ?? null;
    case 'cash': return active.find((m) => m.type === 'cash') ?? null;
    default: return null;
  }
}
