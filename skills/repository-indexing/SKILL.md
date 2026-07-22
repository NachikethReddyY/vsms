---
name: repository-indexing
description: Build, update, and query a semantic repository index to retrieve the smallest highly relevant code context. Use for large-codebase exploration, locating implementations, tracing symbols or call paths, impact analysis, unfamiliar repository questions, and requests to index, search, understand, or retrieve code context. Prefer an existing semantic index when available; otherwise use symbol-aware local discovery without reading whole files or repositories. Do not use for a known tiny file, a user-supplied snippet, or a simple exact-path edit that needs no discovery.
version: 1.0.0
category: code-intelligence
portable: true
---

# Repository Indexing & Context Retrieval

## Purpose

Treat a repository as a continuously updated symbol graph. Retrieve the minimum code needed to answer or implement a request, prioritizing semantic relevance and symbol relationships over file-wide keyword matches.

## Operating Modes

Choose the strongest available mode before searching:

1. **Persistent index** — use an available code-index, vector-search, language-server, or symbol-graph tool.
2. **Build/update index** — when the user requests indexing and writable storage plus parsers and an embedding provider are available, follow `references/index-design.md`.
3. **Ephemeral retrieval** — when no persistent index exists, approximate the pipeline with ignore-aware file discovery, language-server or parser symbols, exact search, Git context, and narrow line-range reads.

Never imply that embeddings, ASTs, references, or call edges exist unless a tool actually produced them.

## Inputs

Use the request plus any available:

- repository path and working directory
- current file, selection, open buffers, and diagnostics
- recently edited files and previous conversation context
- Git diff, status, and focused history
- project manifests, build configuration, and documentation
- existing index location, index API, embedding provider, or language server

## Retrieval Workflow

### 1. Frame the information need

Convert the request into a compact retrieval plan:

- target concepts and likely symbols
- operation: locate, explain, trace, compare, diagnose, or change
- likely languages and architectural layer
- evidence required to answer confidently

Preserve exact identifiers, error strings, routes, configuration keys, and filenames as high-value lexical anchors.

### 2. Establish scope

Discover the project root from explicit input, VCS metadata, or nearby manifests. Read applicable repository instructions before code discovery.

Respect `.gitignore`, nested ignore rules, and tool-specific ignore files. Exclude generated output, dependencies, vendored code, caches, binaries, and secrets unless the request explicitly targets them. Do not traverse outside the selected root.

### 3. Gather high-signal priors

Before broad retrieval, inspect only relevant context:

- current/open/recent files
- changed files and nearby diff hunks
- manifests or configs that identify language, framework, aliases, and entry points
- concise repository maps or existing index metadata

Do not read every manifest or documentation file by default.

### 4. Retrieve candidates

If a semantic index is available:

1. Embed the normalized query.
2. Search chunks using vector similarity plus exact identifier/path matches.
3. Apply metadata filters for root, language, path, branch, or revision.
4. Request snippets and metadata first, not full files.

In ephemeral mode:

1. Enumerate candidate paths with an ignore-aware tool such as `rg --files` or VCS file listing.
2. Search exact identifiers and literals with `rg` before looser concepts.
3. Use language-server, tags, compiler, or Tree-sitter queries for definitions and references when available.
4. Read narrow ranges surrounding the best matches.
5. Expand only when evidence is insufficient.

### 5. Expand through symbols

Expand from high-confidence seeds by relationship, not directory proximity. Prefer, in order:

1. containing symbol or parent type
2. definition of a referenced type or function
3. direct caller or callee relevant to the question
4. import/export or re-export path
5. implementation of an interface or inherited behavior
6. related test, configuration, or documentation

Limit expansion to one hop initially. Add another hop only when it resolves a specific uncertainty. Avoid fan-out through generic utilities or high-degree framework symbols.

### 6. Rerank for precision

Rerank candidates using:

- semantic similarity to intent
- exact symbol, literal, path, and language matches
- graph distance from confirmed seeds
- current/open/changed-file proximity
- definition over reference, and production source over generated source
- freshness at the current revision
- diversity penalties for duplicate or overlapping chunks

Demote boilerplate, barrels, generated files, snapshots, lockfiles, and repeated wrappers unless directly requested.

### 7. Assemble minimal context

Select evidence greedily by information gain. Include:

- complete logical symbols when practical
- required signature, documentation, and local control flow
- only the imports, types, callers, callees, tests, or configuration needed to interpret them
- file path, language, symbol, and line span for every chunk

Prefer several precise symbol chunks over an entire file. Read a whole file only when it is small, its file-level ordering matters, or narrower reads cannot resolve the request. Never load the entire repository unless explicitly requested.

### 8. Verify and stop

Before answering or editing:

- confirm each material claim against retrieved code
- distinguish definitions from references and inferred calls from parser-resolved calls
- detect stale index entries using content hashes or revision metadata
- retrieve one additional targeted chunk for any unresolved claim

Stop when the selected context answers the request and added chunks have low marginal value. Do not continue gathering context merely to increase recall.

## Index Build and Incremental Update

When building or changing a persistent index, read `references/index-design.md` first. Implement these invariants:

- chunk on semantic boundaries, with stable symbol-derived identities
- store content hashes and parser/embedding model versions
- cache parsed trees and embeddings
- reparse only changed files and re-embed only changed chunks
- update graph edges and delete stale chunks transactionally
- separate repository/revision namespaces
- bound queues, batch work, and apply backpressure for large repositories
- keep raw source authoritative; the index is disposable and rebuildable

For filesystem events, debounce bursts and verify file hashes. Treat rename as delete-plus-add unless identity can be preserved safely. Reconcile against VCS or a directory scan after missed events.

## Tool Strategy

Prefer tools in this order when available:

1. repository-native semantic index or code search
2. language server or compiler symbol/reference APIs
3. Tree-sitter or another language-aware parser
4. tags/index databases
5. `rg` for file discovery and lexical search
6. narrow range reads

Use Git for changed-file priors and focused history, not as a substitute for current source. Run independent read-only searches in parallel when doing so reduces latency without broadening context.

## Output Format

For retrieval or explanation, return:

1. the direct answer or finding
2. the smallest supporting set of `path:line` citations
3. relationships used to connect the evidence, when material
4. uncertainty or index limitations, if any

For index construction or maintenance, return:

1. root and ignore policy
2. languages/parsers and chunk strategy
3. storage and embedding choices
4. incremental update behavior
5. validation results and measured retrieval/latency metrics

Do not dump retrieved chunks into the response unless the user asks for them.

## Quality Bar

The result is good only if:

- every included chunk contributes to the answer
- symbol boundaries and source locations are preserved
- exact and semantic retrieval complement each other
- graph expansion is bounded and justified
- changed content cannot silently reuse stale embeddings
- the process works without assuming one language or vendor
- latency and context size are measured rather than guessed when evaluating an index

## Failure Modes

Avoid:

- reading directory trees or whole files before forming a query
- fixed-token chunking that splits logical symbols
- vector-only retrieval that misses exact identifiers
- keyword-only retrieval that misses conceptual matches
- recursively expanding every reference
- indexing ignored, generated, binary, vendored, or secret material
- treating regex call matches as resolved call-graph edges
- re-embedding unchanged chunks
- mixing branches, revisions, repositories, or embedding versions
- claiming semantic search when only lexical tools were used

## Improvement Loop

When retrieval is weak:

1. Label the failure: discovery, parsing, chunking, embedding, graph, reranking, freshness, or context assembly.
2. Add the smallest targeted fix.
3. Re-run representative queries from `evals/evals.json`.
4. Measure precision, evidence coverage, context size, freshness, and latency.
5. Keep the change only if it improves the relevant metric without unacceptable regression.

