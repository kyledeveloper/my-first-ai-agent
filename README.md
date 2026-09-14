# My First AI Agent

Workspace and configuration for my first AI agent, including custom Agent skills, plugins, self-toolmaking scripts, and memory.

## Structure
- `.agents/`: Agent configurations, skills, plugins, memory database, and synthesized scripts.
  - `skills/archify`: Architecture and diagramming skill.
  - `skills/i18n`: Internationalization and localization skill (LobeHub i18n standards).
  - `skills/reflexion-memory`: Long-term episodic memory & anti-mistake retrieval skill.
  - `skills/self-toolmaker`: Self-toolmaking and script asset management skill.
  - `plugins/context-mode`: Project-level context optimization MCP plugin.
  - `scripts/`: Project-specific synthesized CLI tools.
    - `runner.js`: Unified tool dispatcher.
    - `registry.json`: Tool manifest and parameter catalog.
    - `audit-locales.js`: Automated multi-language key alignment audit tool.
  - `memory.db`: SQLite database storing historical episodes, reflections, and tool candidates.
- `src/memory/`: Long-Term Reflexive Memory engine (powered by Node.js native `node:sqlite` + FTS5).
  - `schema.sql`: Database schema for episodes, reflections, and FTS5 search index.
  - `db.js`: Database connection & initialization layer.
  - `reflexion.js`: Distills cause-and-effect lessons and prevents duplicates.
  - `retriever.js`: CJK + Latin bi-gram full-text search with token-efficient prompt formatting.
  - `index.js`: Unified programmatic interface and CLI runner.
- `src/toolmaker/`: Self-Toolmaking & Script Assets Engine.
  - `schema.sql`: Schema for recurring pattern tracking.
  - `tracker.js`: Task frequency accumulation & threshold trigger.
  - `synthesizer.js`: Generates, validates, and registers standard CLI scripts.
  - `registry.js`: Tool catalog manager.
  - `index.js`: Main toolmaker interface.
- `src/i18n.js`: Runtime i18n configuration based on `i18next`.
- `locales/`: Multi-language translation packs (`zh-CN`, `en-US`).
- `examples/`:
  - `demo.js`: Interactive multi-language demo.
  - `demo_memory.js`: Memory retrieval and experience seeding demo.
  - `demo_toolmaker.js`: Self-toolmaking end-to-end demo.
- `test/`:
  - `memory.test.js`: Comprehensive unit tests for LTM engine.
  - `toolmaker.test.js`: Comprehensive unit tests for Self-Toolmaker engine.
