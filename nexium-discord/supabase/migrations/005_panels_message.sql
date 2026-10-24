-- Guarda a mensagem do painel no Discord para o painel web conseguir atualizá-la.
alter table sales_panels add column if not exists message_id text;
