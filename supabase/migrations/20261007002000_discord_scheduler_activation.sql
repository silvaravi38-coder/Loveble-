-- Worker deployed and authenticated HTTP invocation verified before activation.
select cron.schedule('nexium-discord-worker','* * * * *','select public.discord_scheduler_tick();');
