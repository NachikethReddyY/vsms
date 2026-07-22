# Repository guidance

## Fast repository retrieval

A persistent local source index lives at `.repo-index/repository.sqlite` (ignored by Git).

Before broad code exploration in a new session:

1. Run `npm run index:update` to reconcile changed, added, deleted, and renamed files.
2. Query with `npm run index:query -- "<exact identifier or concept>"`.
3. Use the returned symbol-level `path:start-end` spans as retrieval seeds, then read only those spans and at most one relationship hop unless more context is required.

Use `npm run index:status` to inspect freshness and coverage. Use `npm run index:build` only to recreate the database from scratch.

The index is a local SQLite FTS5 lexical/symbol index, not an embedding index. Treat `import` relationships as syntax-derived and other apparent call relationships as unresolved unless confirmed from source or a language-aware tool.
