# My First AI Agent

<p align="left">
  <b>English</b> | <a href="README.zh-CN.md">简体中文</a>
</p>

An autonomous, self-improving AI Agent workspace engineered with **Long-Term Reflexive Memory**, **Dynamic Self-Toolmaking**, **Context Optimization (MCP)**, and **Multi-Language Internationalization**.

---

## Architecture & Capabilities

1. **Long-Term Reflexive Memory (`src/memory/`)**:
   - Stores historical trajectories, failure patterns, root causes, and corrective heuristics instead of static document chunks.
   - Built on native `node:sqlite` (WAL mode + FTS5 full-text indexing) with zero external native compilation dependencies.
   - Multi-dimensional scoring ranking by Relevance ($\alpha=0.5$), Recency exponential decay ($\beta=0.2$), and Importance ($\gamma=0.3$).
2. **Dynamic Self-Toolmaker (`src/toolmaker/` & `.agents/scripts/`)**:
   - Tracks recurring command patterns; automatically synthesizes robust Node.js CLI tools when an operation is performed $\ge 3$ times.
   - Unified dispatcher: `node .agents/scripts/runner.js <tool-name> [args]`.
3. **Context Optimization (`.agents/plugins/context-mode`)**:
   - Scoped project plugin running `context-mode` MCP server to save token consumption on complex tasks.
4. **Interactive Architecture Visualization (`archify`)**:
   - Interactive SVG/HTML system topology maps with light/dark themes and animated trace flows.
5. **Tiered Internationalization (`src/i18n.js` & `locales/`)**:
   - Professional `i18next` integration supporting dynamic switching, locale key audit, and adaptive CLI output.

---

## Directory Structure

```text
.
├── .agents/
│   ├── plugins/context-mode/       # Project-isolated MCP server configuration
│   ├── scripts/                    # Synthesized CLI tool assets (runner.js, audit-locales.js)
│   ├── skills/                     # Agent behavioral skills (archify, reflexion-memory, self-toolmaker, i18n)
│   └── memory.db                   # SQLite persistent episodic & reflective memory database
├── locales/                        # Internationalization locale packs (en-US, zh-CN)
├── src/
│   ├── memory/                     # Reflexion Long-Term Memory engine & FTS5 retriever
│   ├── toolmaker/                  # Pattern tracking and CLI script synthesis engine
│   └── i18n.js                     # Runtime i18next configuration
├── examples/                       # Interactive runnable system demos
├── test/                           # Automated test suites
├── AGENTS.md                       # Authoritative project rules and behavioral guidelines
├── README.md                       # English documentation
└── README.zh-CN.md                 # Chinese documentation
```

---

## Quickstart

### 1. Run Automated Test Suites
```bash
node test/memory.test.js
node test/toolmaker.test.js
```

### 2. Query Long-Term Memory
```bash
node src/memory/index.js search "install sqlite native addons in sandbox"
```

### 3. Run Synthesized Project Tools
```bash
# List all synthesized project tools
node .agents/scripts/runner.js --list

# Run locale audit tool with automatic language adaptation
node .agents/scripts/runner.js audit-locales
```

---

## License
MIT
