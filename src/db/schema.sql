-- Otero SQLite schema v1
-- Modeled on deps/zotero/resource/schema/userdata.sql but simplified.
-- Uses EAV pattern for item fields so different item types can have different field sets.

PRAGMA foreign_keys = ON;

-- ---------------------------------------------------------------------------
-- Schema definitions (seeded at startup)
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS itemTypes (
  itemTypeID   INTEGER PRIMARY KEY,
  typeName     TEXT NOT NULL UNIQUE,
  custom       INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS fields (
  fieldID       INTEGER PRIMARY KEY,
  fieldName     TEXT NOT NULL UNIQUE,
  fieldFormatID INTEGER
);

CREATE TABLE IF NOT EXISTS itemTypeFields (
  itemTypeID INTEGER NOT NULL REFERENCES itemTypes(itemTypeID),
  fieldID    INTEGER NOT NULL REFERENCES fields(fieldID),
  orderIndex INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (itemTypeID, fieldID)
);

CREATE TABLE IF NOT EXISTS baseFieldMappings (
  baseFieldID INTEGER NOT NULL REFERENCES fields(fieldID),
  itemTypeID  INTEGER NOT NULL REFERENCES itemTypes(itemTypeID),
  fieldID     INTEGER NOT NULL REFERENCES fields(fieldID),
  PRIMARY KEY (baseFieldID, itemTypeID)
);

CREATE TABLE IF NOT EXISTS creatorTypes (
  creatorTypeID INTEGER PRIMARY KEY,
  creatorType   TEXT NOT NULL UNIQUE
);

CREATE TABLE IF NOT EXISTS itemTypeCreatorTypes (
  itemTypeID     INTEGER NOT NULL REFERENCES itemTypes(itemTypeID),
  creatorTypeID  INTEGER NOT NULL REFERENCES creatorTypes(creatorTypeID),
  primaryCreator INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (itemTypeID, creatorTypeID)
);

-- ---------------------------------------------------------------------------
-- Core data
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS items (
  itemID         INTEGER PRIMARY KEY AUTOINCREMENT,
  itemTypeID     INTEGER NOT NULL REFERENCES itemTypes(itemTypeID),
  key            TEXT NOT NULL UNIQUE,
  dateAdded      TEXT NOT NULL DEFAULT (datetime('now')),
  dateModified   TEXT NOT NULL DEFAULT (datetime('now')),
  version        INTEGER NOT NULL DEFAULT 0,
  parentItemID   INTEGER REFERENCES items(itemID),
  deleted        INTEGER NOT NULL DEFAULT 0,
  inPublications INTEGER NOT NULL DEFAULT 0
);

CREATE INDEX IF NOT EXISTS items_parent_idx ON items(parentItemID);
CREATE INDEX IF NOT EXISTS items_type_idx ON items(itemTypeID);

CREATE TABLE IF NOT EXISTS itemData (
  itemID  INTEGER NOT NULL REFERENCES items(itemID) ON DELETE CASCADE,
  fieldID INTEGER NOT NULL REFERENCES fields(fieldID),
  valueID INTEGER NOT NULL,
  PRIMARY KEY (itemID, fieldID)
);

CREATE TABLE IF NOT EXISTS itemDataValues (
  valueID INTEGER PRIMARY KEY AUTOINCREMENT,
  value   TEXT NOT NULL UNIQUE
);

CREATE INDEX IF NOT EXISTS itemData_value_idx ON itemData(valueID);

CREATE TABLE IF NOT EXISTS creators (
  creatorID  INTEGER PRIMARY KEY AUTOINCREMENT,
  firstName  TEXT,
  lastName   TEXT,
  fieldMode  INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS itemCreators (
  itemID        INTEGER NOT NULL REFERENCES items(itemID) ON DELETE CASCADE,
  creatorID     INTEGER NOT NULL REFERENCES creators(creatorID),
  creatorTypeID INTEGER NOT NULL REFERENCES creatorTypes(creatorTypeID),
  orderIndex    INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (itemID, creatorID, creatorTypeID)
);

CREATE INDEX IF NOT EXISTS itemCreators_item_idx ON itemCreators(itemID);

-- ---------------------------------------------------------------------------
-- Organization: collections
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS collections (
  collectionID        INTEGER PRIMARY KEY AUTOINCREMENT,
  collectionName      TEXT NOT NULL,
  parentCollectionID  INTEGER REFERENCES collections(collectionID),
  key                 TEXT NOT NULL UNIQUE,
  dateAdded           TEXT NOT NULL DEFAULT (datetime('now')),
  dateModified        TEXT NOT NULL DEFAULT (datetime('now')),
  version             INTEGER NOT NULL DEFAULT 0,
  deleted             INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS collectionItems (
  collectionID INTEGER NOT NULL REFERENCES collections(collectionID) ON DELETE CASCADE,
  itemID       INTEGER NOT NULL REFERENCES items(itemID) ON DELETE CASCADE,
  orderIndex   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (collectionID, itemID)
);

-- ---------------------------------------------------------------------------
-- Attachments / Notes / Annotations
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS itemAttachments (
  itemID        INTEGER PRIMARY KEY REFERENCES items(itemID) ON DELETE CASCADE,
  parentItemID  INTEGER REFERENCES items(itemID),
  linkMode      INTEGER NOT NULL,         -- 0 imported file, 1 imported url,
                                          -- 2 linked file, 3 linked url, 4 embedded image
  contentType   TEXT,
  charset       TEXT,
  path          TEXT,
  syncState     INTEGER,
  md5           TEXT,
  mtime         INTEGER
);

CREATE INDEX IF NOT EXISTS itemAttachments_parent_idx ON itemAttachments(parentItemID);

CREATE TABLE IF NOT EXISTS itemNotes (
  itemID        INTEGER PRIMARY KEY REFERENCES items(itemID) ON DELETE CASCADE,
  parentItemID  INTEGER REFERENCES items(itemID),
  noteHtml      TEXT,
  title         TEXT
);

CREATE TABLE IF NOT EXISTS itemAnnotations (
  itemID        INTEGER PRIMARY KEY REFERENCES items(itemID) ON DELETE CASCADE,
  parentItemID  INTEGER NOT NULL REFERENCES items(itemID),
  type          TEXT NOT NULL,            -- highlight / underline / note / image / ink
  authorName    TEXT,
  text          TEXT,
  comment       TEXT,
  color         TEXT,
  pageLabel     TEXT,
  sortIndex     TEXT,
  position      TEXT,                     -- JSON
  isExternal    INTEGER NOT NULL DEFAULT 0
);

-- ---------------------------------------------------------------------------
-- Relations and system
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS itemRelations (
  itemID    INTEGER NOT NULL REFERENCES items(itemID) ON DELETE CASCADE,
  predicate TEXT NOT NULL,
  object    TEXT NOT NULL,
  PRIMARY KEY (itemID, predicate, object)
);

CREATE TABLE IF NOT EXISTS settings (
  setting TEXT PRIMARY KEY,
  value    TEXT
);

-- ---------------------------------------------------------------------------
-- Full-text parsing (MinerU)
-- Tracks per-item async PDF -> Markdown parsing state. Decoupled from import:
-- triggered on demand. Markdown + assets live under
-- data/storage/<key[0:2]>/<key>/fulltext/ .
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS itemFullText (
  itemID          INTEGER PRIMARY KEY REFERENCES items(itemID) ON DELETE CASCADE,
  state           TEXT NOT NULL DEFAULT 'idle',   -- idle|pending|running|converting|done|failed
  mineruBatchId   TEXT,                            -- MinerU batch_id (single-file batch upload)
  modelVersion    TEXT,                            -- vlm / pipeline
  extractedPages  INTEGER,
  totalPages      INTEGER,
  markdownPath    TEXT,                            -- stored-relative path to full.md
  assetDir        TEXT,                            -- stored-relative path to extracted dir
  errCode         TEXT,
  errMsg          TEXT,
  submittedAt     TEXT,
  completedAt     TEXT,
  dateModified    TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE INDEX IF NOT EXISTS itemFullText_state_idx ON itemFullText(state);

CREATE TABLE IF NOT EXISTS schemaVersion (
  version INTEGER PRIMARY KEY,
  appliedAt TEXT NOT NULL DEFAULT (datetime('now'))
);
