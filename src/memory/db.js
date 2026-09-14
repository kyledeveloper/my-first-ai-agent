const { DatabaseSync } = require('node:sqlite');
const fs = require('fs');
const path = require('path');

const DEFAULT_DB_PATH = path.join(__dirname, '../../.agents/memory.db');

class MemoryDatabase {
  constructor(dbPath = DEFAULT_DB_PATH) {
    this.dbPath = dbPath;
    if (dbPath !== ':memory:') {
      const dir = path.dirname(dbPath);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
      }
    }
    this.db = new DatabaseSync(dbPath);
    this.init();
  }

  init() {
    this.db.exec('PRAGMA foreign_keys = ON;');
    if (this.dbPath !== ':memory:') {
      this.db.exec('PRAGMA journal_mode = WAL;');
    }
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schemaSql = fs.readFileSync(schemaPath, 'utf8');
    this.db.exec(schemaSql);
  }

  insertEpisode({ id, intent, context_summary = '', domain_tags = [], status, created_at = Date.now() }) {
    const stmt = this.db.prepare(`
      INSERT INTO episodes (id, intent, context_summary, domain_tags, status, created_at)
      VALUES (?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, intent, context_summary, JSON.stringify(domain_tags), status, created_at);
  }

  insertReflection({
    id,
    episode_id,
    intent = '',
    trigger_pattern,
    failure_mode = '',
    root_cause,
    corrective_heuristic,
    confidence_score = 1.0,
    hit_count = 0,
    domain_tags = [],
    created_at = Date.now()
  }) {
    const stmt = this.db.prepare(`
      INSERT INTO reflections (id, episode_id, trigger_pattern, failure_mode, root_cause, corrective_heuristic, confidence_score, hit_count, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `);
    stmt.run(id, episode_id, trigger_pattern, failure_mode, root_cause, corrective_heuristic, confidence_score, hit_count, created_at);

    // Sync into FTS5
    const ftsStmt = this.db.prepare(`
      INSERT INTO experience_fts (reflection_id, intent, trigger_pattern, failure_mode, root_cause, corrective_heuristic, domain_tags)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `);
    ftsStmt.run(id, intent, trigger_pattern, failure_mode, root_cause, corrective_heuristic, domain_tags.join(' '));
  }

  incrementHitCount(reflectionId) {
    const stmt = this.db.prepare('UPDATE reflections SET hit_count = hit_count + 1 WHERE id = ?');
    stmt.run(reflectionId);
  }

  close() {
    this.db.close();
  }
}

module.exports = {
  MemoryDatabase,
  DEFAULT_DB_PATH
};
