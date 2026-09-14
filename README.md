# My First AI Agent

Workspace and configuration for my first AI agent, including custom Agent skills, plugins, and tools.

## Structure
- `.agents/`: Agent configurations, skills, plugins, and memory database.
  - `skills/archify`: Architecture and diagramming skill.
  - `skills/i18n`: Internationalization and localization skill (LobeHub i18n standards).
  - `skills/reflexion-memory`: Long-term episodic memory & anti-mistake retrieval skill.
  - `plugins/context-mode`: Project-level context optimization MCP plugin.
  - `memory.db`: SQLite database storing historical episodes and distilled reflections.
- `src/memory/`: Long-Term Reflexive Memory engine (powered by Node.js native `node:sqlite` + FTS5).
  - `schema.sql`: Database schema for episodes, reflections, and FTS5 search index.
  - `db.js`: Database connection & initialization layer.
  - `reflexion.js`: Distills cause-and-effect lessons and prevents duplicates.
  - `retriever.js`: CJK + Latin bi-gram full-text search with token-efficient prompt formatting.
  - `index.js`: Unified programmatic interface and CLI runner.
- `src/i18n.js`: Runtime i18n configuration based on `i18next`.
- `locales/`: Multi-language translation packs (`zh-CN`, `en-US`).
- `examples/`:
  - `demo.js`: Interactive multi-language demo.
  - `demo_memory.js`: Memory retrieval and experience seeding demo.
- `test/`:
  - `memory.test.js`: Comprehensive unit tests for LTM engine.
