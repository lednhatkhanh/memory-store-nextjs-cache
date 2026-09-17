# 29: Replace corrupt cache entries after a safe miss

**What to build:** Make corrupt or incompatible stored values behave as recoverable cache misses for both reads and subsequent atomic replacement writes.

**Blocked by:** 07: Publish streamed cache entries atomically and within bounds.

**Status:** ready-for-agent

- [ ] The Lua publication script validates the decoded JSON envelope and metadata types before reading the existing timestamp.
- [ ] Every value rejected by the TypeScript decoder can be replaced by a valid newer entry without waiting for the corrupt key's TTL.
- [ ] Malformed JSON, JSON scalars, arrays, missing or scalar metadata, invalid timestamps, unsupported versions, and checksum failures all follow the documented miss-and-repair behavior.
- [ ] Repair preserves stale-write fencing whenever a trustworthy existing timestamp is available and fails safely when it is not.
- [ ] A real-Redis regression proves corrupt entry → read miss → successful atomic replacement → valid cross-handler read.
- [ ] Tests also prove a corrupt current value cannot cause partial publication or delete a previously valid replacement written concurrently.
- [ ] A bounded diagnostic distinguishes corruption recovery from an ordinary miss without logging stored content or raw cache keys.

## Comments

- 2026-09-17: The read decoder safely rejects stored JSON `42`, but the publication Lua script
  then indexes `decoded.metadata` without first proving `decoded` is a table. Redis raises
  `attempt to index local 'decoded' (a number value)`, so every replacement fails until the corrupt
  entry expires or is removed externally. A scalar `metadata` value has the same failure mode.
