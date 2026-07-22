#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, statSync } from 'node:fs';
import { dirname, extname, join, relative, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { DatabaseSync } from 'node:sqlite';
import { performance } from 'node:perf_hooks';

const ROOT = resolve(dirname(new URL(import.meta.url).pathname), '..');
const INDEX_DIR = join(ROOT, '.repo-index');
const DB_PATH = join(INDEX_DIR, 'repository.sqlite');
const INDEX_VERSION = '1';
const PARSER_VERSION = 'regex-symbols-v1';
const MAX_FILE_BYTES = 2 * 1024 * 1024;
const MAX_CHUNK_LINES = 240;
const TEXT_EXTENSIONS = new Set([
  '.c', '.cc', '.conf', '.cpp', '.css', '.csv', '.graphql', '.h', '.html',
  '.ini', '.java', '.js', '.json', '.jsx', '.md', '.mjs', '.prisma', '.py',
  '.rb', '.rs', '.scss', '.sh', '.sql', '.svg', '.toml', '.ts', '.tsx',
  '.txt', '.xml', '.yaml', '.yml', '.zsh',
]);
const TEXT_NAMES = new Set([
  '.editorconfig', '.gitattributes', '.gitignore', 'Dockerfile', 'Makefile',
]);
const PRIVATE_EXTENSIONS = new Set(['.key', '.pem', '.p12', '.pfx']);
const PATH_EXCLUDES = [
  /^\.repo-index\//,
  /^(?:\.agents|\.claude|\.codex)\//,
  /^skills\/repository-indexing\//,
  /(^|\/)node_modules\//,
  /(^|\/)(dist|build|coverage|\.next|\.cache|__pycache__)\//,
  /^docs\/ai-transcripts\//,
];

function fail(message) {
  console.error(message);
  process.exitCode = 1;
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex');
}

function git(args) {
  const result = spawnSync('git', args, { cwd: ROOT, encoding: 'buffer' });
  if (result.status !== 0) throw new Error(result.stderr.toString().trim() || 'git failed');
  return result.stdout;
}

function repositoryIdentity() {
  const common = git(['rev-parse', '--git-common-dir']).toString().trim();
  return sha256(`${resolve(ROOT)}\0${resolve(ROOT, common)}`).slice(0, 24);
}

function revisionNamespace() {
  const branch = spawnSync('git', ['symbolic-ref', '--quiet', '--short', 'HEAD'], {
    cwd: ROOT, encoding: 'utf8',
  });
  return branch.status === 0 ? branch.stdout.trim() : `detached:${git(['rev-parse', 'HEAD']).toString().trim()}`;
}

function inventory() {
  const output = git(['ls-files', '-co', '--exclude-standard', '-z']);
  return output.toString().split('\0').filter(Boolean).sort().filter((path) => {
    if (PATH_EXCLUDES.some((pattern) => pattern.test(path))) return false;
    const extension = extname(path).toLowerCase();
    if (PRIVATE_EXTENSIONS.has(extension) || /(^|\/)\.env($|\.)/.test(path)) return false;
    if (!TEXT_EXTENSIONS.has(extension) && !TEXT_NAMES.has(path.split('/').at(-1))) return false;
    const absolute = join(ROOT, path);
    if (!existsSync(absolute) || !statSync(absolute).isFile()) return false;
    return statSync(absolute).size <= MAX_FILE_BYTES;
  });
}

function languageFor(path) {
  const extension = extname(path).toLowerCase();
  return ({
    '.js': 'javascript', '.jsx': 'javascriptreact', '.mjs': 'javascript',
    '.ts': 'typescript', '.tsx': 'typescriptreact', '.md': 'markdown',
    '.json': 'json', '.sql': 'sql', '.prisma': 'prisma', '.py': 'python',
    '.css': 'css', '.scss': 'scss', '.html': 'html', '.yaml': 'yaml',
    '.yml': 'yaml', '.sh': 'shell', '.zsh': 'shell', '.svg': 'svg',
  })[extension] ?? extension.slice(1) ?? 'text';
}

function lineOffsets(text) {
  const offsets = [0];
  for (let index = 0; index < text.length; index += 1) {
    if (text.charCodeAt(index) === 10) offsets.push(index + 1);
  }
  return offsets;
}

function lineAt(offsets, position) {
  let low = 0;
  let high = offsets.length;
  while (low + 1 < high) {
    const middle = (low + high) >> 1;
    if (offsets[middle] <= position) low = middle;
    else high = middle;
  }
  return low + 1;
}

function matchingBraceEnd(text, start) {
  const brace = text.indexOf('{', start);
  if (brace < 0) return -1;
  let depth = 0;
  let quote = '';
  let escaped = false;
  let lineComment = false;
  let blockComment = false;
  for (let index = brace; index < text.length; index += 1) {
    const char = text[index];
    const next = text[index + 1];
    if (lineComment) { if (char === '\n') lineComment = false; continue; }
    if (blockComment) { if (char === '*' && next === '/') { blockComment = false; index += 1; } continue; }
    if (quote) {
      if (escaped) escaped = false;
      else if (char === '\\') escaped = true;
      else if (char === quote) quote = '';
      continue;
    }
    if (char === '/' && next === '/') { lineComment = true; index += 1; continue; }
    if (char === '/' && next === '*') { blockComment = true; index += 1; continue; }
    if (char === '"' || char === "'" || char === '`') { quote = char; continue; }
    if (char === '{') depth += 1;
    if (char === '}' && --depth === 0) return index + 1;
  }
  return -1;
}

function symbolSeeds(text, language) {
  const seeds = [];
  const patterns = language === 'markdown'
    ? [{ kind: 'section', regex: /^(#{1,6})\s+(.+)$/gm, name: 2 }]
    : [
        { kind: 'class', regex: /^(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+([A-Za-z_$][\w$]*)/gm, name: 1, braces: true },
        { kind: 'interface', regex: /^(?:export\s+)?interface\s+([A-Za-z_$][\w$]*)/gm, name: 1, braces: true },
        { kind: 'type', regex: /^(?:export\s+)?type\s+([A-Za-z_$][\w$]*)\s*=/gm, name: 1 },
        { kind: 'function', regex: /^(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][\w$]*)/gm, name: 1, braces: true },
        { kind: 'function', regex: /^(?:export\s+)?(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*(?:async\s*)?(?:\([^\n]*\)|[A-Za-z_$][\w$]*)\s*=>/gm, name: 1, braces: true },
        { kind: 'route', regex: /^\s*(?:router|app)\.(get|post|put|patch|delete|use)\s*\(\s*(['"`])([^'"`]+)\2/gm, name: 3 },
        { kind: 'sql', regex: /^\s*(?:CREATE|ALTER)\s+(?:OR\s+REPLACE\s+)?(?:TABLE|VIEW|FUNCTION|TRIGGER|TYPE)\s+(?:IF\s+NOT\s+EXISTS\s+)?([\w."-]+)/gim, name: 1 },
        { kind: 'prisma', regex: /^\s*(?:model|enum|type)\s+([A-Za-z_][\w]*)/gm, name: 1, braces: true },
      ];
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern.regex)) {
      seeds.push({ start: match.index, name: match[pattern.name].trim(), kind: pattern.kind, braces: pattern.braces });
    }
  }
  return seeds.sort((a, b) => a.start - b.start || a.kind.localeCompare(b.kind));
}

function chunksFor(path, text) {
  const language = languageFor(path);
  const offsets = lineOffsets(text);
  const seeds = symbolSeeds(text, language);
  const chunks = [];
  const occurrences = new Map();
  if (seeds.length === 0) seeds.push({ start: 0, name: path.split('/').at(-1), kind: 'file' });
  for (let index = 0; index < seeds.length; index += 1) {
    const seed = seeds[index];
    const nextStart = seeds[index + 1]?.start ?? text.length;
    let end = seed.braces ? matchingBraceEnd(text, seed.start) : -1;
    if (end < 0 || end > nextStart || language === 'markdown') end = nextStart;
    const startLine = lineAt(offsets, seed.start);
    let endLine = lineAt(offsets, Math.max(seed.start, end - 1));
    endLine = Math.min(endLine, startLine + MAX_CHUNK_LINES - 1);
    const startOffset = offsets[startLine - 1];
    const endOffset = offsets[endLine] ?? text.length;
    const content = text.slice(startOffset, endOffset).trimEnd();
    if (!content.trim()) continue;
    const key = `${seed.kind}:${seed.name}`;
    const occurrence = (occurrences.get(key) ?? 0) + 1;
    occurrences.set(key, occurrence);
    const symbolId = sha256(`${path}\0${key}\0${occurrence}`).slice(0, 32);
    chunks.push({
      chunkId: sha256(`${symbolId}\0part:1`).slice(0, 32), symbolId,
      name: seed.name, kind: seed.kind, startLine, endLine, content,
      contentHash: sha256(content), language,
    });
  }
  return chunks;
}

function importsFor(path, text) {
  const imports = new Set();
  const patterns = [
    /\b(?:import|export)\b[^'"`]*?\bfrom\s*['"`]([^'"`]+)['"`]/g,
    /\brequire\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
    /\bimport\s*\(\s*['"`]([^'"`]+)['"`]\s*\)/g,
  ];
  for (const pattern of patterns) for (const match of text.matchAll(pattern)) imports.add(match[1]);
  return [...imports].map((target) => ({ source: path, target, kind: 'imports', confidence: 0.8 }));
}

function openDatabase({ create = true } = {}) {
  if (!create && !existsSync(DB_PATH)) return null;
  mkdirSync(INDEX_DIR, { recursive: true });
  const db = new DatabaseSync(DB_PATH);
  db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA foreign_keys=ON;');
  db.exec(`
    CREATE TABLE IF NOT EXISTS metadata (key TEXT PRIMARY KEY, value TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS files (
      path TEXT PRIMARY KEY, language TEXT NOT NULL, content_hash TEXT NOT NULL,
      byte_size INTEGER NOT NULL, indexed_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS chunks (
      chunk_id TEXT PRIMARY KEY, symbol_id TEXT NOT NULL, path TEXT NOT NULL,
      language TEXT NOT NULL, symbol_kind TEXT NOT NULL, qualified_name TEXT NOT NULL,
      start_line INTEGER NOT NULL, end_line INTEGER NOT NULL, content_hash TEXT NOT NULL,
      parser_name TEXT NOT NULL, parser_version TEXT NOT NULL, content TEXT NOT NULL,
      FOREIGN KEY(path) REFERENCES files(path) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS chunks_path ON chunks(path);
    CREATE INDEX IF NOT EXISTS chunks_symbol ON chunks(qualified_name);
    CREATE TABLE IF NOT EXISTS edges (
      source_path TEXT NOT NULL, target TEXT NOT NULL, kind TEXT NOT NULL,
      confidence REAL NOT NULL, PRIMARY KEY(source_path, target, kind),
      FOREIGN KEY(source_path) REFERENCES files(path) ON DELETE CASCADE
    );
    CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
      chunk_id UNINDEXED, path, qualified_name, symbol_kind, content,
      tokenize='unicode61 remove_diacritics 2 tokenchars ''_$'''
    );
  `);
  return db;
}

function setMetadata(db, key, value) {
  db.prepare('INSERT INTO metadata(key,value) VALUES (?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').run(key, String(value));
}

function indexRepository({ rebuild = false } = {}) {
  const started = performance.now();
  if (rebuild && existsSync(DB_PATH)) rmSync(DB_PATH);
  const db = openDatabase();
  const repositoryId = repositoryIdentity();
  const namespace = revisionNamespace();
  const existingRepository = db.prepare("SELECT value FROM metadata WHERE key='repository_id'").get()?.value;
  if (existingRepository && existingRepository !== repositoryId) throw new Error('Index belongs to another repository; run index:build.');
  const paths = inventory();
  const current = new Set(paths);
  const oldFiles = new Map(db.prepare('SELECT path, content_hash FROM files').all().map((row) => [row.path, row.content_hash]));
  let added = 0;
  let changed = 0;
  let unchanged = 0;
  let deleted = 0;
  let chunkCount = 0;
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const oldPath of oldFiles.keys()) {
      if (!current.has(oldPath)) {
        db.prepare('DELETE FROM chunks_fts WHERE chunk_id IN (SELECT chunk_id FROM chunks WHERE path=?)').run(oldPath);
        db.prepare('DELETE FROM files WHERE path=?').run(oldPath);
        deleted += 1;
      }
    }
    for (const path of paths) {
      const absolute = join(ROOT, path);
      const content = readFileSync(absolute, 'utf8').replace(/\r\n/g, '\n');
      if (content.includes('\u0000')) continue;
      const contentHash = sha256(content);
      if (oldFiles.get(path) === contentHash) { unchanged += 1; continue; }
      const wasIndexed = oldFiles.has(path);
      const chunks = chunksFor(path, content);
      const edges = importsFor(path, content);
      db.prepare('DELETE FROM chunks_fts WHERE chunk_id IN (SELECT chunk_id FROM chunks WHERE path=?)').run(path);
      db.prepare('DELETE FROM files WHERE path=?').run(path);
      db.prepare('INSERT INTO files(path,language,content_hash,byte_size,indexed_at) VALUES (?,?,?,?,?)')
        .run(path, languageFor(path), contentHash, Buffer.byteLength(content), new Date().toISOString());
      const insertChunk = db.prepare(`INSERT INTO chunks
        (chunk_id,symbol_id,path,language,symbol_kind,qualified_name,start_line,end_line,content_hash,parser_name,parser_version,content)
        VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`);
      const insertFts = db.prepare('INSERT INTO chunks_fts(chunk_id,path,qualified_name,symbol_kind,content) VALUES (?,?,?,?,?)');
      for (const chunk of chunks) {
        insertChunk.run(chunk.chunkId, chunk.symbolId, path, chunk.language, chunk.kind, chunk.name,
          chunk.startLine, chunk.endLine, chunk.contentHash, 'regex-symbols', PARSER_VERSION, chunk.content);
        insertFts.run(chunk.chunkId, path, chunk.name, chunk.kind, chunk.content);
      }
      const insertEdge = db.prepare('INSERT OR REPLACE INTO edges(source_path,target,kind,confidence) VALUES (?,?,?,?)');
      for (const edge of edges) insertEdge.run(edge.source, edge.target, edge.kind, edge.confidence);
      chunkCount += chunks.length;
      if (wasIndexed) changed += 1; else added += 1;
    }
    setMetadata(db, 'index_version', INDEX_VERSION);
    setMetadata(db, 'repository_id', repositoryId);
    setMetadata(db, 'root', ROOT);
    setMetadata(db, 'revision_namespace', namespace);
    setMetadata(db, 'parser_version', PARSER_VERSION);
    setMetadata(db, 'embedding_model', 'none');
    setMetadata(db, 'last_reconciled_at', new Date().toISOString());
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  const totals = db.prepare('SELECT (SELECT count(*) FROM files) files, (SELECT count(*) FROM chunks) chunks, (SELECT count(*) FROM edges) edges').get();
  db.close();
  console.log(JSON.stringify({ database: relative(ROOT, DB_PATH), namespace, added, changed, deleted, unchanged,
    parsedChunks: chunkCount, ...totals, elapsedMs: Math.round((performance.now() - started) * 10) / 10 }, null, 2));
}

function ftsExpression(query) {
  const tokens = query.match(/[\p{L}\p{N}_$.-]+/gu)?.map((token) => token.replaceAll('"', '')) ?? [];
  if (tokens.length === 0) throw new Error('Query must contain searchable text.');
  return tokens.map((token) => `"${token}"*`).join(' OR ');
}

function queryIndex(query, limit = 12) {
  const db = openDatabase({ create: false });
  if (!db) throw new Error('No index found. Run npm run index:build first.');
  const started = performance.now();
  const rows = db.prepare(`
    SELECT c.path, c.qualified_name AS symbol, c.symbol_kind AS kind,
      c.start_line AS startLine, c.end_line AS endLine,
      snippet(chunks_fts, 4, '[', ']', ' … ', 24) AS snippet,
      round(bm25(chunks_fts, 0.0, 2.5, 3.0, 1.0, 1.0), 4) AS score
    FROM chunks_fts JOIN chunks c ON c.chunk_id=chunks_fts.chunk_id
    WHERE chunks_fts MATCH ?
    ORDER BY
      bm25(chunks_fts, 0.0, 2.5, 3.0, 1.0, 1.0)
        + CASE
            WHEN c.path LIKE 'backend/%' OR c.path LIKE 'react-user-dashboard/src/%' THEN -6.0
            WHEN c.path LIKE 'docs/images/%' THEN 5.0
            WHEN c.path LIKE 'docs/%' THEN 2.0
            ELSE 0.0
          END,
      CASE WHEN lower(c.qualified_name)=lower(?) THEN 0 ELSE 1 END,
      CASE c.symbol_kind WHEN 'function' THEN 0 WHEN 'class' THEN 1 WHEN 'route' THEN 2 ELSE 3 END
    LIMIT ?
  `).all(ftsExpression(query), query, limit);
  const paths = [...new Set(rows.map((row) => row.path))];
  const relationships = paths.length === 0 ? [] : db.prepare(`
    SELECT source_path AS source, target, kind, confidence FROM edges
    WHERE source_path IN (${paths.map(() => '?').join(',')}) LIMIT 20
  `).all(...paths);
  const elapsedMs = Math.round((performance.now() - started) * 10) / 10;
  db.close();
  console.log(JSON.stringify({ query, results: rows, relationships, elapsedMs }, null, 2));
}

function status() {
  const db = openDatabase({ create: false });
  if (!db) throw new Error('No index found. Run npm run index:build first.');
  const metadata = Object.fromEntries(db.prepare('SELECT key,value FROM metadata ORDER BY key').all().map((row) => [row.key, row.value]));
  const totals = db.prepare('SELECT (SELECT count(*) FROM files) files, (SELECT count(*) FROM chunks) chunks, (SELECT count(*) FROM edges) edges').get();
  const bytes = statSync(DB_PATH).size;
  const available = inventory();
  const indexedHashes = new Map(db.prepare('SELECT path,content_hash FROM files').all().map((row) => [row.path, row.content_hash]));
  const availableSet = new Set(available);
  let staleCandidateCount = [...indexedHashes.keys()].filter((path) => !availableSet.has(path)).length;
  for (const path of available) {
    const content = readFileSync(join(ROOT, path), 'utf8').replace(/\r\n/g, '\n');
    if (indexedHashes.get(path) !== sha256(content)) staleCandidateCount += 1;
  }
  db.close();
  console.log(JSON.stringify({ database: relative(ROOT, DB_PATH), bytes, ...totals,
    eligibleFilesNow: available.length, staleCandidateCount, metadata }, null, 2));
}

const [command = 'status', ...args] = process.argv.slice(2);
try {
  if (command === 'build') indexRepository({ rebuild: true });
  else if (command === 'update') indexRepository();
  else if (command === 'query') queryIndex(args.join(' ').trim(), Number(process.env.REPO_INDEX_LIMIT ?? 12));
  else if (command === 'status') status();
  else fail(`Unknown command: ${command}`);
} catch (error) {
  fail(error.stack ?? String(error));
}
