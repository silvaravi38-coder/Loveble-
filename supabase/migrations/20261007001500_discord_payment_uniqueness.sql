create unique index if not exists payments_provider_payment_unique on public.payments(provider,provider_payment_id) where provider_payment_id is not null;
