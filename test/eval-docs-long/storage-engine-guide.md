# Storage Engine Guide

This guide describes the storage engine, its query planner, its index
structures, and the performance characteristics operators should expect. It is
written for engineers tuning production deployments.

## Query Planning

The query planner converts a parsed statement into a physical plan. Planning is
cost-based: each candidate plan is assigned an estimated cost derived from table
statistics, and the cheapest plan wins. Statistics are refreshed by a background
analyzer, and a stale analyzer is the most common cause of a bad plan.

The planner considers sequential scans, index scans, and index-only scans. A
sequential scan reads every page in a table. An index scan walks an index to
find matching row identifiers and then fetches those rows. An index-only scan
answers the query entirely from the index, without touching the heap at all.

Join planning is where most performance problems originate. The planner will
choose between nested loop joins, hash joins, and merge joins. Nested loop joins
perform well when the inner relation is small or well indexed. Hash joins
perform well when both relations are large and memory is plentiful. Merge joins
require sorted inputs and perform well when an index already provides ordering.

## Index Structures

The engine supports several index types. The default is a B-tree, which
supports equality and range predicates and provides ordered traversal. B-tree
indexes are balanced on write, so insert-heavy workloads pay a rebalancing cost
that shows up as write amplification.

Hash indexes support equality predicates only. They are smaller than B-tree
indexes for the same column and slightly faster for point lookups, but they
cannot serve range queries and cannot provide ordering for a merge join.

Partial indexes cover a subset of rows defined by a predicate. They are the
correct choice when queries consistently filter on a low-cardinality flag, since
the index stays small and fits in cache. Expression indexes store the result of
a deterministic expression rather than a raw column value.

Covering indexes include extra payload columns so that common queries can be
answered as index-only scans. The tradeoff is index size: every included column
is duplicated, so a wide covering index can approach the size of the table.

## Buffer Management

Pages are read into a shared buffer pool. The pool is divided into fixed-size
frames, and a clock-sweep algorithm selects victims for eviction. Each frame
carries a usage counter that is incremented on access and decremented as the
sweep passes, so frequently used pages survive several sweeps.

Dirty pages cannot be evicted until they have been written out. When the sweep
encounters a dirty page it schedules a write and continues. If the sweep cannot
find a clean victim quickly, backends begin performing their own writes inline,
and latency becomes visibly worse. This condition is called buffer starvation
and is the usual reason for sudden latency spikes under write-heavy load.

Sizing the buffer pool is a balance. Too small and the working set does not fit,
producing constant reads from disk. Too large and the operating system page
cache is starved, producing double buffering and wasted memory.

## Concurrency Control

The engine uses multi-version concurrency control. Each row version carries the
identifier of the transaction that created it and, once superseded, the
identifier of the transaction that removed it. Readers never block writers and
writers never block readers, because a reader simply selects the version
visible to its snapshot.

Snapshots are taken at statement start under read-committed isolation and at
transaction start under repeatable-read isolation. Serializable isolation adds
predicate locking to detect dangerous read-write dependency cycles, aborting one
transaction in the cycle rather than blocking.

Old row versions accumulate and must be reclaimed. The vacuum process removes
versions no longer visible to any live snapshot. A long-running transaction
holds back the reclaim horizon and causes unbounded table growth, which is the
single most common operational failure in long-lived deployments.

## Recovery and Durability

Every modification is recorded in the write-ahead log before the corresponding
data page is modified in the buffer pool. MARKER_DURABILITY the write-ahead log
is the sole mechanism by which durability is guaranteed: a transaction is
considered committed once, and only once, its commit record has been flushed to
stable storage, regardless of whether its data pages have been written. Data
pages are flushed lazily afterwards by the checkpointer.

Recovery replays the log from the last checkpoint. Redo reapplies every change
recorded after the checkpoint, restoring the buffer pool to its state at crash
time. Undo then rolls back transactions that had not committed. Because redo
precedes undo, recovery is idempotent and may be interrupted and restarted.

Checkpoint frequency trades recovery time against steady-state write volume.
Frequent checkpoints shorten recovery but force more full-page writes. Infrequent
checkpoints reduce write volume but lengthen the redo phase after a crash.

## Replication

Physical replication ships log records to standby servers, which replay them
against their own copy of the data files. Standbys may serve read-only queries,
subject to replay lag. Logical replication decodes log records into row-level
change events and applies them through the normal write path, which allows
replicating between different major versions or different schemas.

Synchronous replication waits for a standby to acknowledge a commit record
before reporting success to the client. This bounds data loss at the cost of
latency, and a stalled standby will stall commits unless a quorum is configured.
