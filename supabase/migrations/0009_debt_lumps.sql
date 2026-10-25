-- リボ・分割の一括返済の予定（ボーナスなど）。[{month: 'YYYY-MM', amount, done}]
alter table public.debts add column if not exists lumps jsonb not null default '[]'::jsonb;
