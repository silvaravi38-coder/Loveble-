# NEXIUM Discord executor — 2026-10-06

## Implemented in this delivery

- Supabase jobs schema accepts scan, preview, backup, apply, rebuild, restore, publish, sync and unpublish. The current handler implements **scan, preview and backup only**. The other actions are rejected before execution.
- Jobs record responsible admin, immutable request key, status, result, errors, start/end, attempt count and structured logs. Only one read job per guild can be active. Abandoned read jobs expire after five minutes when another request arrives.
- This first worker runs bounded read jobs within the authenticated Edge request. There is no scheduled queue consumer, durable retry worker or mutation executor yet. Attempts record the highest HTTP retry count in the job (maximum three), rather than the number of worker restarts.
- Scanner reads guild metadata, channels/categories, roles and active threads from Discord REST v10. Reads have timeouts and bounded retry handling. Tokens never enter the client or URLs.
- Atomic snapshot/inventory save with SHA-256 checksum, original IDs, category parent IDs and complete Discord permission/role metadata. Resources remain marked as not managed by Nexium. A second scan updates existing IDs rather than inserting duplicates.
- Preview compares the saved server against the selected Nexium template. Strategies: reuse, fill missing, reorganize and rebuild. Type-aware name matching and saved logical ID bindings avoid choosing ambiguous resources. Managed roles and @everyone are excluded from adoption.
- Preview requires a snapshot less than ten minutes old. Reorganization requires confirmation in the plan; rebuild is blocked. **No create, update or delete Discord API call exists in this version.**
- Admin section can select saved Builder configurations, request reads/previews/structural snapshots and inspect execution history/logs. Public storefront components and styles were not edited.
- New tables have RLS and admin-only read policies. Client/anonymous roles have no write privileges. The atomic scan RPC is SECURITY INVOKER and executable by service_role only.
- Every operation validates the bearer token with auth.getUser and checks the current profiles.role. JWT user metadata is not used for authorization. Public GET health exposes version, supported action names and a token-configured boolean only.

## Verification

- Ten Node tests passed: reuse, conflicts, ID preference, channel types, managed roles, strategy behavior, template switches, authentication failures, 429 retries and bounded network retries.
- Vite/TypeScript production build passed.
- Strict backend check passed using installed Supabase types and Deno ambient declarations (`npm run check:backend`). Full `deno check` could not fetch the pinned dependency because this execution environment refused those dependency URLs. The deployed Edge runtime does resolve its imports; live startup/readiness is verified separately.
- Real database transaction tests passed for concurrent guild lock, rollback of invalid scan, ID upserts, non-admin RLS and grant restrictions. All fixtures were rolled back.
- Foundation migration applied to flcqndjlzuhmxxahjudj.
- discord-executor deployed to Supabase; live health request returned HTTP 200 and **discord_token_configured=false**. An unauthenticated POST returned HTTP 401.
- Actual Discord scan, authenticated Admin browser flow and Discord permissions have **not** been verified: no Discord bot token is configured and no Builder configuration exists in the database at inspection time.
- Security advisors found no notices on the four new tables or the new scan RPC. Existing SECURITY DEFINER functions still have advisor warnings for execute grants; sampled finance/support functions check stored roles/ownership, but a full pre-existing RPC audit is not complete. Leaked-password protection is also reported disabled. No broad access changes were made to existing storefront policies.

## Required setup before the next stage

1. Set DISCORD_BOT_TOKEN in Supabase Edge Function secrets for this project. Obtain the bot token from the relevant application in Discord Developer Portal → Bot. Do not paste it into chat, GitHub, Vite variables or Builder fields.
2. Ensure that application/bot is authorized in the intended Discord server. A token alone does not invite a bot. The correct application ID must be checked against the configured token before generating an invite.
3. Save the Discord server ID in the Builder and select that saved configuration in the executor section. Enable Discord Developer Mode to copy a server ID.
4. Run scan and verify the captured channels, roles, permissions and logical bindings before developing/applying mutations.

## Backup limits

Snapshots are **structural backups**: server/channel/role metadata, permission overwrites and active thread metadata. They do not include messages, archived threads, invites, attachments, member-role assignments or recoverable original IDs after deletion. Restoring deleted channels cannot recover Discord messages. No restore implementation or guarantee exists yet.

## Remaining stages (not delivered or claimed as functional)

1. Validate real scan and add reviewed manual mapping overrides/conflict resolution.
2. Durable worker queue: atomic claims/leases, heartbeat, retry scheduling and operation-level idempotency/reconciliation.
3. Confirmed mutation plans bound to configuration hash, current structure hash and backup; selective rebuild/restore with explicit resource scope and protected IDs. No indiscriminate deletions.
4. Create/update categories, channels, roles and least-privilege overwrites; permission hierarchy checks; logs and panel messages/components. Implement publish/sync/unpublish using persisted message IDs.
5. Signed Discord interactions/OAuth2, customer identity linking and catalogue-driven purchase flow with panel/channel/product attribution.
6. Discord PIX order creation using the existing backend Turbofy functions, webhook verification/reconciliation, idempotent paid events, customer role and delivery dispatch. Existing PIX functions were not changed or revalidated in this delivery.
7. Automatic/manual orders, stock reservation/delivery/restock, coupons and full finance/reporting with site/Discord origin.
8. Professional ticket lifecycle, transcripts, ratings, permanent history and verified resolved-only support payroll. The existing SQL metrics use floor(resolved_month / 30) * R$10; the new Discord ticket lifecycle is not implemented yet.
9. Authorized AI status lookup, suggestions/auto-replies, staff takeover pause and conversation summaries.
10. Scheduled messages, welcome/notification events, anti-raid/fake controls, lock/panic, staff permissions and end-to-end audit/backups.
