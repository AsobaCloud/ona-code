-- CLEAN_ROOM_SPEC.md §4.3 (canonical DDL)

PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS schema_meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS conversations (
    id              TEXT PRIMARY KEY,
    project_dir     TEXT NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    last_active     TEXT NOT NULL DEFAULT (datetime('now')),
    phase           TEXT NOT NULL DEFAULT 'idle'
);

CREATE TABLE IF NOT EXISTS sessions (
    session_id      TEXT PRIMARY KEY,
    conversation_id TEXT NOT NULL REFERENCES conversations(id),
    started_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS state (
    conversation_id TEXT NOT NULL,
    key             TEXT NOT NULL,
    value           TEXT,
    updated_at      TEXT NOT NULL DEFAULT (datetime('now')),
    PRIMARY KEY (conversation_id, key)
);

CREATE TABLE IF NOT EXISTS plans (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    file_path       TEXT,
    content         TEXT NOT NULL,
    hash            TEXT NOT NULL,
    status          TEXT NOT NULL DEFAULT 'draft',
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    approved_at     TEXT,
    completed_at    TEXT
);

CREATE TABLE IF NOT EXISTS summaries (
    conversation_id TEXT PRIMARY KEY REFERENCES conversations(id),
    content         TEXT NOT NULL,
    word_count      INTEGER NOT NULL,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS events (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    session_id      TEXT,
    timestamp       TEXT NOT NULL DEFAULT (datetime('now')),
    event_type      TEXT NOT NULL,
    detail          TEXT
);

CREATE TABLE IF NOT EXISTS task_ratings (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    conversation_id TEXT NOT NULL,
    rating          INTEGER NOT NULL,
    objective       TEXT,
    timestamp       TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS memories (
    id TEXT PRIMARY KEY,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    content TEXT,
    keywords TEXT,
    anticipated_queries TEXT,
    concept_tags TEXT,
    project_scope TEXT,
    correction_count INTEGER DEFAULT 1,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    last_accessed INTEGER,
    access_count INTEGER DEFAULT 0,
    attention_score REAL DEFAULT 0.5
);

CREATE VIRTUAL TABLE IF NOT EXISTS memories_fts USING fts5(
    title, content, keywords, anticipated_queries,
    tokenize='porter unicode61'
);

CREATE TABLE IF NOT EXISTS transcript_entries (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id      TEXT NOT NULL REFERENCES sessions(session_id),
    sequence        INTEGER NOT NULL,
    parent_entry_id INTEGER REFERENCES transcript_entries(id),
    entry_type      TEXT NOT NULL,
    payload_json    TEXT NOT NULL,
    tool_use_id     TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE(session_id, sequence)
);

CREATE INDEX IF NOT EXISTS idx_transcript_session ON transcript_entries(session_id, sequence);

CREATE TABLE IF NOT EXISTS hook_invocations (
    id             INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id     TEXT NOT NULL,
    conversation_id TEXT NOT NULL,
    hook_event     TEXT NOT NULL,
    hook_ordinal   INTEGER NOT NULL,
    matcher        TEXT NOT NULL,
    command        TEXT NOT NULL,
    tool_use_id    TEXT,
    tool_name      TEXT,
    input_json     TEXT NOT NULL,
    exit_code      INTEGER,
    stdout_text    TEXT,
    stderr_text    TEXT,
    started_at     TEXT NOT NULL,
    completed_at   TEXT,
    skipped_reason TEXT
);

CREATE INDEX IF NOT EXISTS idx_hook_inv_session ON hook_invocations(session_id, hook_ordinal);

CREATE TABLE IF NOT EXISTS tool_permission_log (
    id              INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id      TEXT NOT NULL,
    tool_use_id     TEXT NOT NULL,
    tool_name       TEXT NOT NULL,
    decision        TEXT NOT NULL,
    reason_json     TEXT,
    created_at      TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS settings_snapshot (
    scope      TEXT PRIMARY KEY,
    json       TEXT NOT NULL,
    updated_at TEXT NOT NULL
);
