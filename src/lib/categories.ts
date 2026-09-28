// カテゴリの初期セット（04_機能要件.md 3 章）と並び替え。
// ID は固定 UUID にしている。複数の端末で初期化しても、同期時に同じ行として扱われるため。

import type { Category, CategoryKind } from './types';

interface SeedParent {
  id: string;
  name: string;
  kind: CategoryKind;
  children: { id: string; name: string }[];
}

const SEED: SeedParent[] = [
  { id: '11111111-0001-4000-8000-000000000000', name: '食費', kind: 'variable', children: [
    { id: '11111111-0001-4000-8000-000000000001', name: '食料品' },
    { id: '11111111-0001-4000-8000-000000000002', name: '外食' },
    { id: '11111111-0001-4000-8000-000000000003', name: 'カフェ' },
    { id: '11111111-0001-4000-8000-000000000004', name: 'コンビニ' },
  ] },
  { id: '11111111-0002-4000-8000-000000000000', name: '交際費', kind: 'variable', children: [
    { id: '11111111-0002-4000-8000-000000000001', name: 'デート' },
    { id: '11111111-0002-4000-8000-000000000002', name: '飲み会' },
    { id: '11111111-0002-4000-8000-000000000003', name: 'プレゼント' },
    { id: '11111111-0002-4000-8000-000000000004', name: '冠婚葬祭' },
  ] },
  { id: '11111111-0003-4000-8000-000000000000', name: '日用品', kind: 'variable', children: [
    { id: '11111111-0003-4000-8000-000000000001', name: '日用雑貨' },
    { id: '11111111-0003-4000-8000-000000000002', name: '消耗品' },
  ] },
  { id: '11111111-0004-4000-8000-000000000000', name: '交通費', kind: 'variable', children: [
    { id: '11111111-0004-4000-8000-000000000001', name: '電車・バス' },
    { id: '11111111-0004-4000-8000-000000000002', name: 'タクシー' },
    { id: '11111111-0004-4000-8000-000000000003', name: 'ガソリン' },
  ] },
  { id: '11111111-0005-4000-8000-000000000000', name: '趣味・娯楽', kind: 'variable', children: [
    { id: '11111111-0005-4000-8000-000000000001', name: 'ゴルフ' },
    { id: '11111111-0005-4000-8000-000000000002', name: '映画・音楽' },
    { id: '11111111-0005-4000-8000-000000000003', name: '書籍' },
    { id: '11111111-0005-4000-8000-000000000004', name: 'ゲーム' },
  ] },
  { id: '11111111-0006-4000-8000-000000000000', name: '衣服・美容', kind: 'variable', children: [
    { id: '11111111-0006-4000-8000-000000000001', name: '衣服' },
    { id: '11111111-0006-4000-8000-000000000002', name: '美容院' },
    { id: '11111111-0006-4000-8000-000000000003', name: '化粧品' },
  ] },
  { id: '11111111-0007-4000-8000-000000000000', name: '健康・医療', kind: 'variable', children: [
    { id: '11111111-0007-4000-8000-000000000001', name: '病院' },
    { id: '11111111-0007-4000-8000-000000000002', name: '薬' },
    { id: '11111111-0007-4000-8000-000000000003', name: 'フィットネス（都度）' },
  ] },
  { id: '11111111-0008-4000-8000-000000000000', name: '教養・教育', kind: 'variable', children: [
    { id: '11111111-0008-4000-8000-000000000001', name: '書籍（学習）' },
    { id: '11111111-0008-4000-8000-000000000002', name: 'セミナー' },
  ] },
  { id: '11111111-0009-4000-8000-000000000000', name: '水道・光熱費', kind: 'semi_fixed', children: [
    { id: '11111111-0009-4000-8000-000000000001', name: '電気' },
    { id: '11111111-0009-4000-8000-000000000002', name: 'ガス' },
    { id: '11111111-0009-4000-8000-000000000003', name: '水道' },
  ] },
  { id: '11111111-0010-4000-8000-000000000000', name: '住宅', kind: 'fixed', children: [
    { id: '11111111-0010-4000-8000-000000000001', name: '家賃' },
    { id: '11111111-0010-4000-8000-000000000002', name: '管理費' },
  ] },
  { id: '11111111-0011-4000-8000-000000000000', name: '通信費', kind: 'fixed', children: [
    { id: '11111111-0011-4000-8000-000000000001', name: '携帯' },
    { id: '11111111-0011-4000-8000-000000000002', name: 'インターネット' },
  ] },
  { id: '11111111-0012-4000-8000-000000000000', name: 'サブスク', kind: 'fixed', children: [
    { id: '11111111-0012-4000-8000-000000000001', name: 'サブスク' },
  ] },
  { id: '11111111-0013-4000-8000-000000000000', name: '返済', kind: 'fixed', children: [
    { id: '11111111-0013-4000-8000-000000000001', name: 'ローン返済' },
    { id: '11111111-0013-4000-8000-000000000002', name: 'リボ・分割返済' },
  ] },
  { id: '11111111-0014-4000-8000-000000000000', name: '貯蓄・投資', kind: 'fixed', children: [
    { id: '11111111-0014-4000-8000-000000000001', name: '積立投資' },
    { id: '11111111-0014-4000-8000-000000000002', name: '旅行積立' },
  ] },
  { id: '11111111-0015-4000-8000-000000000000', name: '特別な支出', kind: 'variable', children: [
    { id: '11111111-0015-4000-8000-000000000001', name: '家電' },
    { id: '11111111-0015-4000-8000-000000000002', name: '引越し' },
    { id: '11111111-0015-4000-8000-000000000003', name: '旅行' },
    { id: '11111111-0015-4000-8000-000000000004', name: '税金' },
  ] },
  { id: '11111111-0016-4000-8000-000000000000', name: 'その他', kind: 'variable', children: [
    { id: '11111111-0016-4000-8000-000000000001', name: 'その他' },
  ] },
];

/** クイック記録の初期の並び（04 の 3.2）。ここにない中分類は大分類の順 */
const QUICK_ORDER = ['デート', '外食', '食料品', 'コンビニ', 'カフェ', '日用雑貨', '電車・バス', 'タクシー', '飲み会', 'その他'];

export const OTHER_CATEGORY_ID = '11111111-0016-4000-8000-000000000001';

export function seedCategories(now: string): Category[] {
  const out: Category[] = [];
  let order = 100;
  SEED.forEach((p, pi) => {
    out.push({ id: p.id, name: p.name, parent_id: null, kind: p.kind, sort_order: pi, use_count: 0, is_active: true, created_at: now, updated_at: now, deleted_at: null });
    for (const c of p.children) {
      const q = QUICK_ORDER.indexOf(c.name);
      const sort_order = q >= 0 ? q : order++;
      out.push({ id: c.id, name: c.name, parent_id: p.id, kind: p.kind, sort_order, use_count: 0, is_active: true, created_at: now, updated_at: now, deleted_at: null });
    }
  });
  return out;
}

/** 有効な中分類を、使用回数の多い順（同数なら初期の並び順）に返す */
export function orderedSubcategories(all: Category[]): Category[] {
  return all
    .filter((c) => c.parent_id !== null && c.is_active && !c.deleted_at)
    .sort((a, b) => b.use_count - a.use_count || a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'ja'));
}

export function parentsOf(all: Category[]): Category[] {
  return all.filter((c) => c.parent_id === null && !c.deleted_at).sort((a, b) => a.sort_order - b.sort_order);
}

export function childrenOf(all: Category[], parentId: string): Category[] {
  return all
    .filter((c) => c.parent_id === parentId && !c.deleted_at)
    .sort((a, b) => a.sort_order - b.sort_order || a.name.localeCompare(b.name, 'ja'));
}

export function categoryById(all: Category[], id: string | null): Category | undefined {
  if (!id) return undefined;
  return all.find((c) => c.id === id);
}
