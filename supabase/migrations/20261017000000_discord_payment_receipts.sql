-- Dedicated destination and switch for Discord payment receipts.
alter table public.discord_bot_settings
  add column if not exists pix_log_channel_id text,
  add column if not exists notify_sale_paid boolean not null default true;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid='public.discord_bot_settings'::regclass
      and conname='discord_bot_settings_pix_log_channel_id_check'
  ) then
    alter table public.discord_bot_settings
      add constraint discord_bot_settings_pix_log_channel_id_check
      check (pix_log_channel_id is null or pix_log_channel_id ~ '^[0-9]{17,20}$');
  end if;
end $$;
