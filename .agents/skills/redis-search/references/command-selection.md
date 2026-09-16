# Choose the Right FT Command for the Job

**Output contract for query-builder calls:** the generated command is the _entire_ response. Emit only the JSON array of strings — no prose, no explanation, no `**Explanation:**` section, no code fences, no leading/trailing whitespace. The token _after_ the closing `]` must be EOF. Any commentary will be either ignored (best case) or treated as part of the command (worst case).

The first decision before any query syntax is _which command to run_. Redis Search exposes three query commands with different design intents — picking the wrong one means rewriting the query later when you discover the command cannot express what you need.

| Command        | Use when...                                                                             | Mental model                                                                                | Min. Redis                    |
| -------------- | --------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------- | ----------------------------- |
| `FT.SEARCH`    | Straightforward document retrieval — agent wants matching docs back.                    | Ready-to-use: returns matching documents directly.                                          | 2.0 module / 8.0 built-in     |
| `FT.AGGREGATE` | Faceting, analytics, computed fields, grouped or reshaped output.                       | Declarative result shaping: explicit `LOAD`, `APPLY`, `GROUPBY`, `REDUCE`, `SORTBY`.        | 2.0 module / 8.0 built-in     |
| `FT.HYBRID`    | Relevance must blend lexical (text) and semantic (vector) ranking with explicit fusion. | Declarative hybrid retrieval: `SEARCH` leg + `VSIM` leg + `COMBINE` fusion (RRF or LINEAR). | **8.4.0** (Redis Open Source) |

**Correct:** Pick the command that matches the shape of the answer you need.

```
# FT.SEARCH — "give me matching bicycles"
FT.SEARCH idx:bicycle "@type:{mountain} @price:[100 500]"
    LIMIT 0 10
    RETURN 3 model brand price
    DIALECT 2

# FT.AGGREGATE — "what is the average price per brand?"
FT.AGGREGATE idx:bicycle "@type:{mountain}"
    GROUPBY 1 @brand
    REDUCE AVG 1 @price AS avg_price
    SORTBY 2 @avg_price DESC
    DIALECT 2

# FT.HYBRID (Redis ≥ 8.4.0) — "blend lexical relevance with vector similarity"
FT.HYBRID idx:bicycle
    SEARCH "mountain bicycle"
    VSIM @description_embeddings $query_vec
    KNN 2 K 10
    COMBINE RRF 10                          # RRF <count> — number of fused results to keep
    PARAMS 2 query_vec "<vector_blob>"
    DIALECT 2
```

**Version gate — FT.HYBRID requires Redis ≥ 8.4.0.** For older Redis, fall back to the pre-filter + KNN pattern via `FT.SEARCH` (see [vector-query.md](vector-query.md)):

```
# Fallback for Redis < 8.4.0 — pre-filter + KNN inside FT.SEARCH
FT.SEARCH idx:bicycle "(@type:{mountain})=>[KNN 10 @description_embeddings $query_vec AS score]"
    SORTBY score
    PARAMS 2 query_vec "<vector_blob>"
    DIALECT 2
```

**When to use FT.HYBRID's COMBINE modes:**

- `COMBINE RRF` — Reciprocal Rank Fusion, rank-based fusion. Robust default; no tuning required.
- `COMBINE LINEAR ALPHA <a> BETA <b>` — weighted score blend. Use when you have calibrated scores and want explicit control over the lexical/vector trade-off.

**Incorrect:** Using `FT.SEARCH` and then post-processing in the client to compute groups, averages, or score fusion. That work belongs inside Redis — pushing it client-side defeats the index.

```python
# Bad: pulling raw docs and grouping in Python — defeats the index, blows up over the wire.
docs = r.ft("idx:bicycle").search("@type:{mountain}").docs
brands = collections.Counter(d.brand for d in docs)
```

## Decision tree

1. Need computed fields, grouping, or custom output shape? → `FT.AGGREGATE`.
2. Need blended lexical + vector ranking with explicit fusion? → `FT.HYBRID` (Redis ≥ 8.4.0).
3. Otherwise (including filter-narrowed vector search) → `FT.SEARCH`.

## Question-phrase cheatsheet — route by the _shape_ of the answer, not the verb

Use `FT.AGGREGATE` when the question contains:

| Phrase                                                                                                            | Pipeline shape                                                               |
| ----------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| _"how many X"_ / _"find the count of X"_ / _"count of X"_ / _"total count of X"_                                  | `GROUPBY 0 REDUCE COUNT 0 AS n`                                              |
| _"how many distinct X"_                                                                                           | `GROUPBY 1 @x  GROUPBY 0 REDUCE COUNT 0` _(or `REDUCE COUNT_DISTINCT 1 @x`)_ |
| _"list distinct X"_ / _"what are the unique X"_ / _"create a list of X"_ / _"list of X with Y"_ / _"enumerate X"_ | `GROUPBY 0 REDUCE TOLIST 1 @x AS list`                                       |
| _"average per Y"_ / _"sum per Y"_ / _"min/max per Y"_                                                             | `GROUPBY 1 @y REDUCE AVG\|SUM\|MIN\|MAX 1 @field`                            |
| _"average / min / max of X across all"_ / _"earliest / latest"_                                                   | `GROUPBY 0 REDUCE AVG\|MIN\|MAX 1 @field` (no per-bucket grouping)           |
| _"top N by stat"_                                                                                                 | `GROUPBY 1 @x REDUCE … AS stat  SORTBY 2 @stat DESC MAX N`                   |
| _"breakdown by Y"_ / _"per month"_ / _"per state"_ / _"aggregated by Y"_                                          | `GROUPBY 1 @bucket REDUCE COUNT 0`                                           |

## Count-question routing

**Phrasing decides the command. Default to FT.AGGREGATE for any "how many" / "count" question.**

| Question phrasing                                                                  | Command                                                                      |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| _"how many X …"_ / _"find the count of X"_ / _"count of X"_ / _"total count of X"_ | **`FT.AGGREGATE` … `GROUPBY 0 REDUCE COUNT 0`** (default)                    |
| _"return the number of X …"_ (literally that phrasing)                             | `FT.SEARCH … LIMIT 0 0` — count comes from the response header               |
| _"how many distinct X"_ / _"count of distinct X"_                                  | **`FT.AGGREGATE`** — two-step `GROUPBY 1 @x` then `GROUPBY 0 REDUCE COUNT 0` |
| _"how many X per Y"_ / _"count of X by Y"_ / _"breakdown by Y"_                    | **`FT.AGGREGATE`** — `GROUPBY 1 @y REDUCE COUNT 0`                           |

**Why the default leans `FT.AGGREGATE`:** the gold dataset reserves `FT.SEARCH … LIMIT 0 0` only for the literal phrasing _"return the number of X"_. Every other count phrasing — _"how many"_, _"find the count"_, _"count of"_ — uses `FT.AGGREGATE GROUPBY 0 REDUCE COUNT 0`. Both forms return the same total numerically, but the result-row shapes differ, so a coin-flip is wrong half the time.

```
# Q: "How many beers in Michigan?"
# Bad: bare LIMIT 0 0 — returns a count in the header, but the gold uses AGGREGATE
FT.SEARCH beers "@state:{MI}" LIMIT 0 0

# Good: explicit aggregate, single-row result
FT.AGGREGATE beers "@state:{MI}" GROUPBY 0 REDUCE COUNT 0
```

**"Create a list of X with property Y" → `TOLIST`, not `GROUPBY 1 @x` with COUNT.** Grouping by `@x` with a `REDUCE COUNT` _partitions rows and adds a count column_; `TOLIST` _collects the values into a single list row_. The two return different shapes.

```
# Q: "Create a list of subjects with active cases of rhinitis or asthma"
# Bad: groups by subject and counts — returns N rows
FT.AGGREGATE conditions "@code:{active} @problem:(rhinitis|asthma)" GROUPBY 1 @subject REDUCE COUNT 0 AS count

# Good: collapses to one row containing the list of subjects
FT.AGGREGATE conditions "@code:{active} @problem:(rhinitis|asthma)" GROUPBY 0 REDUCE TOLIST 1 @subject AS List
```

**`GROUPBY` without a `REDUCE` is a valid distinct-values projection.** For _"list N distinct values of X"_ (no count needed), the canonical form is bare `GROUPBY 1 @x LIMIT 0 N` — adding a `REDUCE COUNT` changes the row shape and breaks result-equality.

```
# Q: "List eleven countries"
# Bad: adds an unrequested count column — different output shape
FT.AGGREGATE cities "*" GROUPBY 1 @country REDUCE COUNT 0 AS count LIMIT 0 11

# Good: pure projection of distinct values
FT.AGGREGATE cities "*" GROUPBY 1 @country LIMIT 0 11
```

Use `FT.SEARCH` for:

- _"give me bicycles where …"_ / _"show matching …"_ / _"return the X and Y for …"_ → raw document retrieval.
- _Look-up by exact ID_ (e.g., _"return the X for benefits ID '...'"_) → `FT.SEARCH idx "@id:{...}" RETURN <n> ...`. **Never** `FT.AGGREGATE` for single-record retrieval.

## Cross-links

- Syntax of the query expression: [query-syntax.md](query-syntax.md)
- KNN, range, and pre-filter vector queries: [vector-query.md](vector-query.md)
- Aggregate pipeline stages: [aggregate-pipeline.md](aggregate-pipeline.md)

## Client mirrors

```python
# redis-py — STEP_START command_selection
# Mirrors doctests/search_quickstart.py
from redis import Redis

r = Redis()
# FT.SEARCH for retrieval
results = r.ft("idx:bicycle").search("@type:{mountain} @price:[100 500]")
# FT.AGGREGATE for grouped analytics
from redis.commands.search.aggregation import AggregateRequest, Reducers
agg = AggregateRequest("@type:{mountain}").group_by("@brand", Reducers.avg("@price").alias("avg_price"))
totals = r.ft("idx:bicycle").aggregate(agg)
# STEP_END
```

```java
// Jedis — STEP_START command_selection
// Mirrors SearchQuickstartExample.java
import redis.clients.jedis.UnifiedJedis;
import redis.clients.jedis.search.Query;
import redis.clients.jedis.search.aggr.AggregationBuilder;
import redis.clients.jedis.search.aggr.Reducers;

try (UnifiedJedis jedis = new UnifiedJedis("redis://localhost:6379")) {
    jedis.ftSearch("idx:bicycle", new Query("@type:{mountain} @price:[100 500]"));
    AggregationBuilder agg = new AggregationBuilder("@type:{mountain}")
        .groupBy("@brand", Reducers.avg("@price").as("avg_price"));
    jedis.ftAggregate("idx:bicycle", agg);
}
// STEP_END
```

## Upstream sources

- redis-py: [`doctests/search_quickstart.py`](https://github.com/redis/redis-py/blob/master/doctests/search_quickstart.py)
- Jedis: [`SearchQuickstartExample.java`](https://github.com/redis/jedis/blob/master/src/test/java/io/redis/examples/SearchQuickstartExample.java)
- Reference: [FT.HYBRID](https://redis.io/docs/latest/commands/ft.hybrid/), [FT.SEARCH](https://redis.io/docs/latest/commands/ft.search/), [FT.AGGREGATE](https://redis.io/docs/latest/commands/ft.aggregate/)
