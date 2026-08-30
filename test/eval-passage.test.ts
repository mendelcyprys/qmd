/**
 * Passage-level search quality evaluation.
 *
 * test/eval.test.ts measures Hit@K at the *document* level: did the right file
 * appear in the top K. That cannot see which passage of a document is returned,
 * and every document in test/eval-docs/ is under 900 tokens — a single chunk —
 * so chunk selection is a no-op there.
 *
 * These fixtures are deliberately multi-chunk, with the answer to each query
 * placed in a late chunk while earlier chunks are dense in the query's own
 * vocabulary. That makes lexical and semantic chunk selection disagree, which is
 * the case hybridQuery's chunk handling has to get right.
 *
 * Two properties are measured:
 *   1. answer recall  — the returned passage contains the answer, not merely
 *                       the right file;
 *   2. lexical safety — an exact-phrase query still returns the passage that
 *                       literally contains the phrase, so preferring
 *                       vector-matched chunks has not broken keyword queries.
 */

import { describe, test, expect, beforeAll, afterAll } from "vitest";
import { readFileSync, readdirSync, mkdtempSync } from "fs";
import { join, dirname } from "path";
import { tmpdir } from "os";
import { createHash } from "crypto";
import { fileURLToPath } from "url";

const tempDir = mkdtempSync(join(tmpdir(), "qmd-eval-passage-"));
process.env.INDEX_PATH = join(tempDir, "eval-passage.sqlite");

import {
  createStore,
  hybridQuery,
  insertDocument,
  insertContent,
  insertEmbedding,
  chunkDocumentByTokens,
  DEFAULT_EMBED_MODEL,
} from "../src/store";
import { getDefaultLlamaCpp, formatDocForEmbedding } from "../src/llm";

/** Query whose answer sits in a late chunk, behind a keyword-dense decoy. */
const answerQueries: { query: string; marker: string }[] = [
  {
    query: "how is durability guaranteed before data pages are written",
    marker: "MARKER_DURABILITY",
  },
  {
    query: "who assigns the owner of the postmortem after an incident",
    marker: "MARKER_POSTMORTEM",
  },
  {
    query: "how long must a release soak in staging before going to production",
    marker: "MARKER_PROMOTION",
  },
];

/** Exact-phrase query: the passage returned must literally contain the phrase. */
const lexicalQueries: { query: string; phrase: string }[] = [
  { query: "hash joins", phrase: "hash joins" },
  { query: "clock-sweep algorithm", phrase: "clock-sweep" },
  { query: "blameless reviews", phrase: "blameless" },
  { query: "flaky tests quarantined", phrase: "quarantine" },
];

describe.skipIf(!!process.env.CI)("Passage-level search quality", () => {
  let store: ReturnType<typeof createStore>;

  beforeAll(async () => {
    store = createStore();
    const llm = getDefaultLlamaCpp();
    store.ensureVecTable(768);

    const docsDir = join(dirname(fileURLToPath(import.meta.url)), "eval-docs-long");
    for (const file of readdirSync(docsDir).filter(f => f.endsWith(".md"))) {
      const content = readFileSync(join(docsDir, file), "utf-8");
      const title = content.split("\n")[0]?.replace(/^#\s*/, "") || file;
      const hash = createHash("sha256").update(content).digest("hex").slice(0, 12);
      const now = new Date().toISOString();

      insertContent(store.db, hash, content, now);
      insertDocument(store.db, "eval-docs-long", file, title, hash, now, now);

      const chunks = await chunkDocumentByTokens(content);
      // A single-chunk fixture would make these tests vacuous.
      expect(chunks.length).toBeGreaterThan(1);
      for (let seq = 0; seq < chunks.length; seq++) {
        const chunk = chunks[seq];
        if (!chunk) continue;
        const result = await llm.embed(formatDocForEmbedding(chunk.text, title), {
          model: DEFAULT_EMBED_MODEL,
          isQuery: false,
        });
        if (result?.embedding) {
          insertEmbedding(
            store.db, hash, seq, chunk.pos,
            new Float32Array(result.embedding), DEFAULT_EMBED_MODEL, now,
          );
        }
      }
    }

    // Expansion is a separate concern and needs the generate model; these tests
    // measure chunk selection, so drive the pipeline with the raw query only.
    store.expandQuery = (async () => []) as never;
  }, 300000);

  afterAll(() => {
    store.close();
  });

  async function topPassage(query: string): Promise<string> {
    const results = await hybridQuery(store, query, {
      limit: 5, minScore: 0, skipRerank: true,
    });
    return results[0]?.bestChunk ?? "";
  }

  test("answer recall: the returned passage contains the answer", async () => {
    const hits: string[] = [];
    const misses: string[] = [];
    for (const { query, marker } of answerQueries) {
      const passage = await topPassage(query);
      (passage.includes(marker) ? hits : misses).push(marker);
    }
    expect(misses, `missed: ${misses.join(", ")}`).toEqual([]);
    expect(hits).toHaveLength(answerQueries.length);
  }, 300000);

  test("lexical safety: exact-phrase queries return the passage containing the phrase", async () => {
    const misses: string[] = [];
    for (const { query, phrase } of lexicalQueries) {
      const passage = await topPassage(query);
      if (!passage.toLowerCase().includes(phrase.toLowerCase())) misses.push(phrase);
    }
    // Preferring vector-matched chunks must not pull an exact-phrase query onto
    // a neighbouring passage that does not contain the term.
    expect(misses, `phrase not in returned passage: ${misses.join(", ")}`).toEqual([]);
  }, 300000);
});
