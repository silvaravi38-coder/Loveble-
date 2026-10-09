# Discord review and manual delivery

The live read-only audit passed 76 checks covering registered commands, botconfig pages, catalogue panels, reports and ticket access. These checks do not prove every state-changing flow. Historical interaction failures were reviewed; there were no newer failures in the retrieved records.

A concrete configuration problem affected all 14 active products: automatic delivery was enabled with zero available supplier stock and no reusable delivery template. The owner's earlier request specified manual delivery. All 14 were switched through the authorized product-delivery RPC; no display quantities were invented. All 11 active sales panels were refreshed successfully.

Manual delivery alerts are queued for paid Discord orders with undelivered manual items. They go to the configured private log channel, include product quantities and payment time, and alert again after 9 hours toward the 10-hour deadline. Unique outbox keys prevent duplicate alerts. Closed/delivered orders suppress pending alerts before sending. The delivery button requires a second confirmation, a linked admin or assigned support account, the same guild, confirmed payment, and no outstanding automatic items. Completion is transactional and idempotent. Customer DMs follow the existing delivery notification preference. Keys and credentials are not placed in logs.

Payment notifications are now queued before granting the customer role. A role/hierarchy failure is recorded without turning confirmed payment into an apparent failure; the fulfillment worker can retry the role.

Validation: 99 Node tests; strict backend type check; SQL rollback tests for alert creation, deduplication, deadline, authorization, guild isolation, unpaid-order rejection, completion and idempotency. Live verification confirmed a private log channel and customer DMs enabled. No real charge or order delivery was performed for testing.

Remaining observed blocker: the bot lacks Manage Threads. Private ticket creation works; deleting threads remains blocked until the owner grants that permission. This was verified again after deployment.

Scope: delivery alerts currently cover orders created through the Discord checkout. Website-only orders require a separately defined guild/staff routing policy.
