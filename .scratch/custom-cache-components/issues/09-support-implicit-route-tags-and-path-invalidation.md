# 09: Support implicit route tags and path invalidation

**What to build:** Make path revalidation in the Next.js reference application invalidate every relevant cached route dependency while leaving unrelated routes and content reusable.

**Blocked by:** 05: Invalidate committed content across instances.

**Status:** ready-for-agent

- [ ] Cached page content, layout dependencies, and metadata expose the expected implicit route-tag behavior through the production reference application.
- [ ] Revalidating a path through the normal Next.js API causes subsequent server requests through both instances to observe the current revision.
- [ ] A Server Action-only behavior, where applicable to the pinned release, is exercised through an actual Server Action.
- [ ] Unrelated routes and explicitly unrelated tags remain reusable after path invalidation.
- [ ] Assertions include rendered output, metadata, and source-read counts rather than inspecting only Redis state.
- [ ] Route coverage records which framework cache layers were demonstrated and avoids claiming untested layers are shared.
- [ ] The route, layout, metadata, and revalidation pattern remains a copyable consumer example; deterministic source controls stay in support services or tests.
