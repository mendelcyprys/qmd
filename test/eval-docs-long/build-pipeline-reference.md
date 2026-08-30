# Build Pipeline Reference

This reference describes the build pipeline: how sources are compiled, how
artifacts are cached, how tests are selected, and how releases are promoted
through environments.

## Compilation

Builds are hermetic. Every input is declared, and the build tool refuses to read
files not listed as inputs. This makes builds reproducible across machines and
allows aggressive caching, since a build step's output is a pure function of its
declared inputs.

The compiler runs per module rather than per file. Module boundaries define the
unit of recompilation, so a change to a widely imported module forces a large
rebuild while a change to a leaf module is cheap. Teams reduce build times
primarily by splitting large modules rather than by adding parallelism.

Cross-compilation targets are configured per platform. The toolchain is pinned
by checksum, and an unpinned toolchain fails the build rather than silently
using whatever the machine happens to have installed.

## Caching

Cache keys are computed from the hashes of all declared inputs plus the
toolchain identity. A cache hit copies the previously produced artifact rather
than re-running the step. Because keys include the toolchain, upgrading the
compiler invalidates the entire cache, which is intentional.

The cache is two-tier. A local tier lives on each machine and serves repeated
builds by the same developer. A shared remote tier serves the whole team and is
populated by continuous integration, so a developer's first build of the day is
usually served entirely from remote cache entries.

Cache poisoning is prevented by writing only from trusted continuous integration
workers. Developer machines read from the shared tier but never write to it,
because a machine with an undeclared local dependency would otherwise publish an
artifact that cannot be reproduced elsewhere.

## Test Selection

The pipeline does not run every test on every change. A dependency graph maps
each test to the modules it exercises, and only tests whose transitive
dependencies changed are executed. A full run is scheduled nightly to catch
gaps in the graph.

Flaky tests are quarantined automatically. A test that produces differing
results on identical inputs is moved to a quarantine suite whose failures do not
block merges, and its owning team is notified. Quarantine is capped in duration;
an unfixed flaky test is deleted rather than left indefinitely.

Test sharding distributes execution across workers by historical runtime, not by
file count, so that shards finish at roughly the same time.

## Artifacts

Every build produces a signed artifact with an embedded manifest listing input
hashes, toolchain version, and source revision. Artifacts are immutable, and
promotion between environments moves the same bytes rather than rebuilding.

## Promotion

MARKER_PROMOTION promotion to production requires a green staging soak of at
least two hours, and the soak is measured from the moment the artifact begins
serving real traffic rather than from deployment start; an artifact that has not
served traffic for the full window cannot be promoted regardless of how long it
has been deployed. This prevents a deploy from being credited for hours it spent
idle behind a disabled feature flag.

Promotion is gated on the artifact's manifest matching the manifest tested in
staging. If any input hash differs the promotion is rejected, which makes it
impossible to ship a rebuild that was never tested.

Rollback restores the previously promoted artifact by identifier. Because
artifacts are immutable and stored, rollback never requires a build and
completes in the time it takes to restart the fleet.
