# 13: Recover safely from Redis restart or restored state

**What to build:** Make Redis interruption and data rollback recover according to an explicit safety policy rather than silently trusting invalidation state that may have been lost.

**Blocked by:** 10: Prevent metadata loss from reviving obsolete entries; 12: Degrade safely during Redis and source failures.

**Status:** ready-for-agent

- [ ] Testcontainers scenarios interrupt and restart Redis without relying on another test worker's database or resources.
- [ ] Existing `ioredis` clients reconnect within the documented bounds and resume only after their state is safe to use.
- [ ] Cache reads and invalidations during the interruption follow the failure policy from ticket 12.
- [ ] A scenario representing restoration of older Redis state proves that the system does not silently trust invalidation history that disappeared.
- [ ] The recovery policy states what durable guarantee is available from the selected production topology and what application action is required when it cannot be guaranteed.
- [ ] Recovery diagnostics make a safety reset or degraded mode distinguishable from an ordinary cold cache.
- [ ] Repeated restart and reconnect scenarios leave no leaked containers, clients, or child processes.
