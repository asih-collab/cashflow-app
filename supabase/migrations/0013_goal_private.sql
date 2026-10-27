-- 貯金の目標を「鍵付き」にする（端末の鍵（暗証番号）を開くまで、目標の名前・金額を見せない。ほかの画面では別名で表示）
alter table public.goals add column if not exists is_private boolean not null default false;
alter table public.goals add column if not exists alias text not null default '貯金';
