-- 収入のカテゴリ（給与・賞与など）を持てるようにする
alter table public.categories drop constraint if exists categories_kind_check;
alter table public.categories add constraint categories_kind_check check (kind in ('variable','semi_fixed','fixed','income'));
