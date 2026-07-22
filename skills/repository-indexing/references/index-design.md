# Persistent Index Design

Read this reference only when designing, building, or materially changing a repository index. It is not required for ordinary retrieval from an existing index.

## Architecture

Use a staged, restartable pipeline:

```text
root + ignore rules
  -> file inventory
  -> language detection
  -> parse / symbol extraction
  -> semantic chunks
  -> relationships
  -> embeddings
  -> transactional index update
  -> hybrid retrieval + graph expansion + reranking
```

Keep stages connected by stable identifiers and content hashes so unchanged work can be reused.

## Root and File Discovery

Prefer an explicit root. Otherwise choose the nearest VCS root, then the nearest recognized project manifest. Record nested roots rather than silently merging unrelated repositories.

Combine VCS ignore semantics with configurable tool ignores. Use allowlists for recognized text/source formats plus content-based binary detection. Symlink traversal must be explicit, cycle-safe, and confined to the root.

For very large repositories, stream the inventory and batch downstream work; do not hold every file body in memory.

## Parsing and Symbols

Prefer Tree-sitter for broad, incremental syntax coverage. Use compiler or language-server data when semantic resolution materially improves accuracy. Maintain a parser adapter interface so regex fallback is isolated and marked low confidence.

Normalize these entities where supported:

- modules and files
- classes, structs, traits, interfaces, and protocols
- functions, methods, constructors, and closures with names
- enums, variants, constants, fields, and significant variables
- imports, exports, aliases, and re-exports
- documentation and comments attached to symbols

Record qualified name, kind, signature, visibility, byte and line ranges, containing symbol, and parser confidence. Preserve language-specific details in an extensible metadata field.

## Semantic Chunking

Primary chunks are logical symbols. A chunk should contain enough local context to be intelligible:

- attached documentation and annotations
- signature and body
- containing type header when needed
- a minimal set of relevant imports or type aliases

Use a file/module section for top-level statements or prose. If a symbol exceeds the model limit, split at nested semantic boundaries and retain parent identity plus ordered part numbers. Merge tiny adjacent declarations only when they form one coherent unit.

Derive chunk identity from repository namespace, normalized path, symbol identity, and structural position. Derive reuse from normalized content hash. Do not use line numbers alone as identity.

## Graph Model

Represent nodes for files/modules, symbols, chunks, and external packages. Useful typed edges include:

- `contains` / `member_of`
- `defines` / `references`
- `imports` / `exports` / `reexports`
- `calls`
- `inherits` / `implements`
- `type_uses`
- `overrides`
- `tested_by`

Store source span, resolver, and confidence on inferred edges. Keep unresolved references as explicit candidates rather than inventing a resolved target. Suppress or cap traversal through high-degree nodes.

## Storage

The storage implementation may be one database or several coordinated stores, but it must support:

- approximate nearest-neighbor vector search
- exact metadata and lexical lookup
- typed graph-neighbor queries
- transactional replacement by file
- deletion by repository, revision, file, and chunk

Store at minimum:

```text
repository_id, revision_namespace, path, language
chunk_id, symbol_id, symbol_kind, qualified_name
start_line, end_line, content_hash
parser_name, parser_version, embedding_model, embedding_version
embedding, searchable_text, metadata
```

Raw source remains in the working tree or authoritative source store. Avoid duplicating secrets in logs or telemetry.

## Incremental Update Algorithm

For each changed path:

1. Resolve current ignore status and content hash.
2. If deleted or newly ignored, transactionally remove its chunks and incident edges.
3. If unchanged, do nothing.
4. Incrementally parse using the cached tree when supported.
5. Extract new symbols, chunks, and outgoing relationships.
6. Match chunks by stable identity and content hash.
7. Reuse embeddings for unchanged chunk content under the same embedding version.
8. Embed only new or changed chunks in bounded batches.
9. Replace file-owned records and edges atomically.
10. Schedule resolution of affected inbound references.

Coalesce watcher events, use bounded queues, retry idempotently, and persist checkpoints. Periodically reconcile watcher state with the filesystem or VCS to recover from missed events.

## Retrieval and Context Budgeting

Use hybrid retrieval. Fuse semantic score, exact symbol/text match, path prior, graph proximity, recency/current-file prior, and source quality. Calibrate scores per language or corpus when necessary.

Start graph expansion from a small seed set. Allocate a context budget across evidence roles—primary implementation, required definitions, relevant callers/callees, and tests/configuration. Deduplicate overlapping spans. A chunk earns inclusion only if it resolves a query facet or makes another selected chunk understandable.

## Evaluation

Create a benchmark from real repository questions with human-labeled evidence spans. Include identifier lookup, conceptual behavior, cross-file trace, implementation discovery, impact analysis, changed-code questions, and near-miss distractors.

Measure:

- precision@k and recall@k for evidence chunks
- mean reciprocal rank or nDCG
- answer evidence coverage
- retrieved tokens and unique files per query
- p50/p95 retrieval latency
- incremental indexing time and embedding reuse rate
- freshness after edit, rename, delete, and branch switch

Optimize precision and context size first, subject to adequate evidence coverage. Track results by language and repository size so aggregate scores do not hide weak adapters.

