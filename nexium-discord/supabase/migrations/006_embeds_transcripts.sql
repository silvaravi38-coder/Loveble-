-- Transcrição de tickets (opcional) e quem atendeu cada pedido.
alter table discord_settings add column if not exists save_transcripts boolean not null default true;
alter table orders add column if not exists handled_by text;
