---
name: self-toolmaker
description: AI Agent Self-Toolmaking and Script Assets Engine. Consult this skill to check available project-specific synthesized CLI tools in .agents/scripts/, or to synthesize new automated scripts when performing repetitive (>= 3 times) tasks.
user-invocable: true
---

# Self-Toolmaker: AI Agent 自造工具系统

This skill allows the AI Agent to evolve into a **Toolmaker** rather than just a tool user.
When project-specific tasks are performed repeatedly, the agent encapsulates them into permanent, reliable, tested CLI tools.

---

## 1. Using Existing Synthesized Tools (优先调用已有工具)

Before executing multi-step ad-hoc shell commands, **always check if a project-specific tool already exists**:

Check registered tools:
```bash
node .agents/scripts/runner.js --list
```

Run a tool:
```bash
node .agents/scripts/runner.js <tool-name> [options]
```

### Currently Available Project Tools:
- **`audit-locales`**: Audit and compare keys across locale files (e.g. `zh-CN` vs `en-US`) to detect missing or extra translation keys.
  - Usage: `node .agents/scripts/runner.js audit-locales [--base locales/zh-CN] [--target locales/en-US] [--json]`

---

## 2. When to Synthesize New Tools (何时触发自造工具)

When any of the following conditions occur:
1. You notice you or the user are performing the same multi-step data processing or code conversion task for the **3rd time**;
2. A complex one-liner regex, jq, or AST manipulation command is frequently used;
3. A repetitive project health-check or build verification step is needed.

---

## 3. How to Synthesize and Register a New Tool

Use the Toolmaker engine in Node.js:
```javascript
const { getToolmaker } = require('./src/toolmaker/index');
const toolmaker = getToolmaker();

toolmaker.synthesizeTool({
  name: 'my-custom-tool',
  description: 'Concise explanation of what this tool does',
  parameters: [
    { name: 'input', description: 'Input file path', default: 'src/index.js' }
  ],
  codeBody: `
    // Standalone logic using args.<param>
    console.log("Executed with:", args.input);
  `,
  examples: ['--input src/main.js']
});
```

This automatically:
1. Generates `.agents/scripts/<name>.js` with `--help`, parameter parsing, and error handling.
2. Validates syntax with `node -c`.
3. Registers it into `.agents/scripts/registry.json`.
4. Makes it immediately callable via `node .agents/scripts/runner.js <name>`.
