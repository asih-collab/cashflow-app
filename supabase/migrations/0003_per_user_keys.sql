-- 複数の利用者に対応する: 初期データ（カテゴリ・支払い手段）は固定 UUID なので、
-- 主キーを (user_id, id) の組にして、利用者が違えば同じ id でも別の行として扱う。
-- 参照（外部キー）も (user_id, …) の組にして、他人の行を指せないようにする。

-- 既存の外部キー・主キーを外す
alter table public.transactions drop constraint if exists transactions_category_id_fkey;
alter table public.transactions drop constraint if exists transactions_payment_method_id_fkey;
alter table public.categories   drop constraint if exists categories_parent_id_fkey;
alter table public.transactions drop constraint if exists transactions_pkey;
alter table public.categories   drop constraint if exists categories_pkey;
alter table public.payment_methods drop constraint if exists payment_methods_pkey;

-- 利用者ごとの主キー
alter table public.categories      add primary key (user_id, id);
alter table public.payment_methods add primary key (user_id, id);
alter table public.transactions    add primary key (user_id, id);

-- 同じ利用者の行だけを参照できる外部キー
alter table public.categories
  add constraint categories_parent_fkey foreign key (user_id, parent_id) references public.categories (user_id, id);
alter table public.transactions
  add constraint transactions_category_fkey foreign key (user_id, category_id) references public.categories (user_id, id),
  add constraint transactions_payment_method_fkey foreign key (user_id, payment_method_id) references public.payment_methods (user_id, id);
