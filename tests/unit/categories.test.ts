import { describe, expect, it } from 'vitest';
import { seedCategories, orderedSubcategories, incomeSubcategories, parentsOf, childrenOf, OTHER_CATEGORY_ID } from '../../src/lib/categories';

describe('カテゴリ初期セット', () => {
  const all = seedCategories('2026-09-28T00:00:00.000Z');
  it('大分類 17（うち収入 1）、中分類にデートを含む', () => {
    expect(parentsOf(all)).toHaveLength(17);
    const names = all.filter((c) => c.parent_id).map((c) => c.name);
    expect(names).toContain('デート');
    expect(names).toContain('外食');
    expect(all.find((c) => c.id === OTHER_CATEGORY_ID)?.name).toBe('その他');
  });
  it('ID は重複しない', () => {
    expect(new Set(all.map((c) => c.id)).size).toBe(all.length);
  });
  it('中分類は親の種別（固定/変動）を引き継ぐ', () => {
    const rent = all.find((c) => c.name === '家賃')!;
    expect(rent.kind).toBe('fixed');
    const date = all.find((c) => c.name === 'デート')!;
    expect(date.kind).toBe('variable');
  });
  it('クイック記録の初期の並びは 04 の 3.2 に従う', () => {
    const q = orderedSubcategories(all).map((c) => c.name);
    expect(q.slice(0, 10)).toEqual(['デート', '外食', '食料品', 'コンビニ', 'カフェ', '日用雑貨', '電車・バス', 'タクシー', '飲み会', 'その他']);
  });
  it('使用回数が多いものが前に来る。同数なら初期順', () => {
    const copy = seedCategories('2026-09-28T00:00:00.000Z');
    copy.find((c) => c.name === 'カフェ')!.use_count = 5;
    copy.find((c) => c.name === '外食')!.use_count = 5;
    copy.find((c) => c.name === 'タクシー')!.use_count = 9;
    const q = orderedSubcategories(copy).map((c) => c.name);
    expect(q.slice(0, 4)).toEqual(['タクシー', '外食', 'カフェ', 'デート']);
  });
  it('非表示・削除済みは出ない', () => {
    const copy = seedCategories('2026-09-28T00:00:00.000Z');
    copy.find((c) => c.name === 'デート')!.is_active = false;
    copy.find((c) => c.name === '外食')!.deleted_at = '2026-09-28T00:00:00.000Z';
    const q = orderedSubcategories(copy).map((c) => c.name);
    expect(q).not.toContain('デート');
    expect(q).not.toContain('外食');
  });
  it('childrenOf は親配下だけ', () => {
    const food = parentsOf(all).find((p) => p.name === '食費')!;
    expect(childrenOf(all, food.id).map((c) => c.name).sort()).toEqual(['カフェ', 'コンビニ', '外食', '食料品'].sort());
  });
  it('収入の中分類は支出の並びに出ず、収入用の一覧にだけ出る', () => {
    const exp = orderedSubcategories(all).map((c) => c.name);
    const inc = incomeSubcategories(all).map((c) => c.name);
    expect(exp).not.toContain('給与');
    expect(inc).toEqual(['給与', '賞与', '副業', '臨時収入', 'その他の収入']);
    expect(all.find((c) => c.name === '給与')!.kind).toBe('income');
  });
});
