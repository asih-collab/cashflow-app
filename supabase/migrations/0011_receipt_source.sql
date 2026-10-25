-- レシートの読み取りで入れた記録（source = 'receipt'）を許す
alter table public.transactions drop constraint if exists transactions_source_check;
alter table public.transactions add constraint transactions_source_check check (source in ('manual','recurring','shortcut','csv','receipt'));
