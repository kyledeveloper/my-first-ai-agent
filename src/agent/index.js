#!/usr/bin/env node
/**
 * Unified Agent Loop
 *
 * Glue for the five pillars: retrieve reflexion memory, suggest/run a
 * synthesized tool, optionally compute blast-radius, and write failures back.
 *
 *   node src/agent/index.js plan  "<intent>" [--target <fileOrSymbol>]
 *   node src/agent/index.js run   "<intent>" [--tool <name> [--exec]] [--] [tool-args]
 *   node src/agent/index.js reflect --intent x --trigger y --cause z --heuristic h
 *   node src/agent/index.js tools
 */

const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');
const { LongTermMemory, DEFAULT_DB_PATH } = require('../memory/index');
const { calculateBlastRadius } = require('../graph/blastRadius');

const DEFAULT_REGISTRY = path.join(__dirname, '../../.agents/scripts/registry.json');
const DEFAULT_ROOT = path.resolve(__dirname, '../../');

function hasUncommittedDiff(rootDir, target) {
  const resolved = path.resolve(rootDir, target);
  const rel = path.relative(rootDir, resolved);
  const opts = { cwd: rootDir, encoding: 'utf8', timeout: 5000 };
  const unstaged = spawnSync('git', ['diff', '--', rel], opts);
  const staged = spawnSync('git', ['diff', '--cached', '--', rel], opts);
  if ((unstaged.error || staged.error)) return false;
  return Boolean((unstaged.stdout || '').trim() || (staged.stdout || '').trim());
}

function summarizeBlast(report, rootDir) {
  return {
    target: report.target,
    targetType: report.targetType,
    riskLevel: report.riskLevel,
    riskScore: report.riskScore,
    directCount: report.directCount,
    testCount: report.testCount,
    impactedTests: (report.impactedTests || []).map(f => path.relative(rootDir, f)),
    safetyPlan: report.safetyPlan,
    isDiffAware: Boolean(report.isDiffAware),
    scope: report.scope || null,
    notes: report.notes || null,
    semantic: report.semanticAnalysis
      ? {
          mode: report.semanticAnalysis.mode,
          overallVerdict: report.semanticAnalysis.overallVerdict,
          hasBreaking: report.semanticAnalysis.hasBreaking
        }
      : null
  };
}

class AgentLoop {
  constructor(options = {}) {
    this.rootDir = path.resolve(options.rootDir || DEFAULT_ROOT);
    this.registryPath = options.registryPath || path.join(this.rootDir, '.agents/scripts/registry.json');
    this.dbPath = options.dbPath || DEFAULT_DB_PATH;
    this.memory = options.memory || null;
    this.ownsMemory = !options.memory;
    this.toolmaker = options.toolmaker || null;
  }

  _memory() {
    if (!this.memory) {
      this.memory = new LongTermMemory(this.dbPath);
    }
    return this.memory;
  }

  listTools() {
    if (this.toolmaker) {
      return this.toolmaker.listTools();
    }
    if (!fs.existsSync(this.registryPath)) return [];
    try {
      const data = JSON.parse(fs.readFileSync(this.registryPath, 'utf8'));
      return Object.values(data.tools || {});
    } catch (e) {
      return [];
    }
  }

  /**
   * Score registered tools against an intent by token overlap.
   */
  suggestTools(intent, tools = this.listTools()) {
    const tokens = String(intent || '')
      .toLowerCase()
      .split(/[^a-z0-9\u4e00-\u9fa5]+/i)
      .filter(t => t.length >= 3);
    if (tokens.length === 0) return [];

    return tools
      .map(tool => {
        const hay = `${tool.name || ''} ${tool.description || ''}`.toLowerCase();
        const score = tokens.filter(tok => hay.includes(tok)).length;
        return { tool, score };
      })
      .filter(row => row.score > 0)
      .sort((a, b) => b.score - a.score)
      .map(row => row.tool);
  }

  /**
   * Read-only pre-task step: memory + tool suggestions + optional blast-radius.
   */
  plan(intent, { target, limit = 3 } = {}) {
    if (!intent || !String(intent).trim()) {
      throw new Error('plan() requires a non-empty intent');
    }

    const memory = this._memory();
    const lessons = memory.query(String(intent).trim(), { limit });
    const guidance = memory.formatPrompt(lessons);
    const suggestedTools = this.suggestTools(intent);

    let blastRadius = null;
    if (target) {
      const dirty = hasUncommittedDiff(this.rootDir, target);
      const report = calculateBlastRadius(target, {
        rootDir: this.rootDir,
        diffAware: dirty,
        semantic: dirty
      });
      blastRadius = summarizeBlast(report, this.rootDir);
    }

    return { intent: String(intent).trim(), lessons, guidance, suggestedTools, blastRadius };
  }

  /**
   * Run a registered tool via argv array (no shell interpolation).
   */
  execute(toolName, toolArgs = []) {
    const tool = this.listTools().find(t => t.name === toolName);
    if (!tool) {
      return {
        ok: false,
        status: 1,
        tool: toolName,
        stdout: '',
        stderr: `Tool "${toolName}" not found in registry.`,
        scriptPath: null
      };
    }

    const scriptPath = path.isAbsolute(tool.scriptPath)
      ? tool.scriptPath
      : path.join(this.rootDir, tool.scriptPath);

    if (!fs.existsSync(scriptPath)) {
      return {
        ok: false,
        status: 1,
        tool: toolName,
        stdout: '',
        stderr: `Script file not found at: ${scriptPath}`,
        scriptPath
      };
    }

    const child = spawnSync(process.execPath, [scriptPath, ...toolArgs], {
      encoding: 'utf8',
      cwd: this.rootDir,
      timeout: 30000
    });

    const status = child.status === null ? 1 : child.status;
    return {
      ok: status === 0,
      status,
      tool: toolName,
      stdout: child.stdout || '',
      stderr: child.stderr || (child.error ? child.error.message : ''),
      scriptPath
    };
  }

  /**
   * Distill a diagnosed episode into long-term memory.
   */
  reflect(data) {
    return this._memory().recordExperience(data);
  }

  /**
   * Plan, optionally execute a tool, and write a failure back into memory.
   */
  run(intent, {
    tool = null,
    args = [],
    target = null,
    exec = false,
    recordOnFailure = true
  } = {}) {
    const planned = this.plan(intent, { target });

    let chosen = tool;
    if (!chosen && exec && planned.suggestedTools.length === 1) {
      chosen = planned.suggestedTools[0].name;
    }

    if (!chosen) {
      return { ...planned, executed: false, result: null, recorded: null };
    }

    const result = this.execute(chosen, args);
    let recorded = null;

    if (!result.ok && recordOnFailure) {
      const prior = planned.lessons[0];
      const errorSignature = String(result.stderr || '')
        .split('\n')
        .find(l => l.includes('Error') || l.includes('fail') || l.includes('invalid')) || '';
      recorded = this.reflect({
        intent,
        trigger_pattern: `tool:${chosen}`,
        failure_mode: String(result.stderr || result.stdout || 'non-zero exit').slice(0, 500),
        root_cause: errorSignature
          ? `Tool "${chosen}" failed: ${errorSignature.trim().slice(0, 150)} (status ${result.status})`
          : `Tool "${chosen}" exited with status ${result.status}`,
        corrective_heuristic: prior
          ? prior.corrective_heuristic
          : `Inspect stderr for ${chosen}, fix the root cause, then re-run the agent loop.`,
        status: 'failure',
        domain_tags: ['agent-loop', chosen]
      });
    }

    return { ...planned, executed: true, result, recorded };
  }

  close() {
    if (this.ownsMemory && this.memory) {
      this.memory.close();
      this.memory = null;
    }
  }
}

function splitArgv(argv) {
  const idx = argv.indexOf('--');
  if (idx === -1) return { own: argv, passthrough: [] };
  return { own: argv.slice(0, idx), passthrough: argv.slice(idx + 1) };
}

function parseArgs(argv) {
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help' || arg === '-h') {
      args.help = true;
    } else if (arg === '--json') {
      args.json = true;
    } else if (arg === '--exec') {
      args.exec = true;
    } else if (arg.startsWith('--')) {
      const rawKey = arg.slice(2);
      if (rawKey.includes('=')) {
        const eqIdx = rawKey.indexOf('=');
        args[rawKey.slice(0, eqIdx)] = rawKey.slice(eqIdx + 1);
      } else if (i + 1 < argv.length && !argv[i + 1].startsWith('--')) {
        args[rawKey] = argv[++i];
      } else {
        args[rawKey] = true;
      }
    } else {
      args._.push(arg);
    }
  }
  return args;
}

function printUsage() {
  console.log(`
Unified Agent Loop
==================
Usage:
  node src/agent/index.js plan    "<intent>" [--target <fileOrSymbol>] [--json]
  node src/agent/index.js run     "<intent>" [--tool <name> [--exec]] [--target <file>] [--] [tool-args]
  node src/agent/index.js reflect --intent <text> --trigger <text> --cause <text> --heuristic <text>
  node src/agent/index.js tools   [--json]

Flow: retrieve memory → suggest/run a synthesized tool → optional blast-radius → record failures.

Options:
  --tool <name>       Tool to execute (run)
  --exec              Execute the unique suggested tool when --tool is omitted
  --target <path>     Blast-radius for this file/symbol (auto --diff --semantic if it has uncommitted changes)
  --registry <path>   Override tool registry.json
  --db <path>         Override memory database path
  --root <path>       Project root (default: repository root)
  --json              Machine-readable output
  --help, -h          Show this help
`);
}

function printPlan(report, json) {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  console.log('=== Agent Loop: Plan ===');
  console.log(`Intent: ${report.intent}`);
  console.log();

  if (report.guidance) {
    console.log(report.guidance);
  } else {
    console.log('No prior reflexion lessons matched this intent.');
  }

  console.log();
  if (report.suggestedTools.length === 0) {
    console.log('Suggested tools: (none — pass --tool <name> --exec to run one)');
  } else {
    console.log(`Suggested tools (${report.suggestedTools.length}):`);
    for (const t of report.suggestedTools) {
      console.log(`  • ${t.name} — ${t.description || ''}`);
    }
  }

  if (report.blastRadius) {
    const br = report.blastRadius;
    console.log();
    console.log(`Blast radius: ${br.target} [${br.targetType}]  ${br.riskLevel} (${br.riskScore}/100)`);
    if (br.isDiffAware) {
      console.log(`  Diff scope: ${br.scope || 'unknown'}${br.notes ? ' — ' + br.notes : ''}`);
    }
    if (br.semantic) {
      console.log(`  Semantic: ${br.semantic.overallVerdict} (${br.semantic.mode})`);
    }
    console.log(`  Direct callers: ${br.directCount}   Impacted tests: ${br.testCount}`);
    if (br.safetyPlan && br.safetyPlan.steps) {
      for (const step of br.safetyPlan.steps) {
        console.log(`  ${step}`);
      }
    }
  }
}

function printRun(report, json) {
  if (json) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }
  printPlan(report, false);
  console.log();
  if (!report.executed) {
    console.log('No tool executed. Re-run with --tool <name> --exec (or --exec when exactly one tool is suggested).');
    return;
  }
  const r = report.result;
  console.log(`Executed: ${r.tool}  (exit ${r.status})`);
  if (r.stdout) process.stdout.write(r.stdout.endsWith('\n') ? r.stdout : r.stdout + '\n');
  if (r.stderr) process.stderr.write(r.stderr.endsWith('\n') ? r.stderr : r.stderr + '\n');
  if (report.recorded) {
    console.log(`Recorded failure reflection: ${report.recorded.id}`);
  }
}

function createLoopFromArgs(args) {
  return new AgentLoop({
    rootDir: args.root || DEFAULT_ROOT,
    registryPath: args.registry || DEFAULT_REGISTRY,
    dbPath: args.db
  });
}

function main() {
  const { own, passthrough } = splitArgv(process.argv.slice(2));
  const args = parseArgs(own);

  if (args.help || args._.length === 0) {
    printUsage();
    process.exit(args.help ? 0 : 1);
  }

  const command = args._[0];
  const intent = args.intent || args._.slice(1).join(' ').trim();
  const loop = createLoopFromArgs(args);
  const json = !!args.json;

  try {
    if (command === 'plan') {
      if (!intent) {
        console.error('plan requires an intent string.');
        printUsage();
        process.exit(1);
      }
      printPlan(loop.plan(intent, { target: args.target }), json);
      process.exit(0);
    }

    if (command === 'run') {
      if (!intent) {
        console.error('run requires an intent string.');
        printUsage();
        process.exit(1);
      }
      const report = loop.run(intent, {
        tool: args.tool || null,
        args: passthrough,
        target: args.target || null,
        exec: !!args.exec || !!args.tool,
        recordOnFailure: args['record-failure'] !== 'false'
      });
      printRun(report, json);
      process.exit(report.executed && report.result && !report.result.ok ? report.result.status : 0);
    }

    if (command === 'reflect') {
      const trigger = args.trigger;
      const cause = args.cause || args['root-cause'];
      const heuristic = args.heuristic;
      if (!intent || !trigger || !cause || !heuristic) {
        console.error('reflect requires --intent, --trigger, --cause, and --heuristic.');
        process.exit(1);
      }
      const recorded = loop.reflect({
        intent,
        trigger_pattern: trigger,
        failure_mode: args['failure-mode'] || '',
        root_cause: cause,
        corrective_heuristic: heuristic,
        status: args.status || 'recovered',
        domain_tags: String(args.tags || 'agent-loop').split(',').map(s => s.trim()).filter(Boolean)
      });
      if (json) {
        console.log(JSON.stringify(recorded, null, 2));
      } else {
        console.log(recorded.reinforced
          ? `Reinforced existing reflection: ${recorded.id}`
          : `Recorded reflection: ${recorded.id}`);
      }
      process.exit(0);
    }

    if (command === 'tools') {
      const tools = loop.listTools();
      if (json) {
        console.log(JSON.stringify({ tools }, null, 2));
      } else {
        console.log('=== Registered Tools ===');
        if (tools.length === 0) {
          console.log('(none)');
        } else {
          for (const t of tools) {
            console.log(`  • ${t.name} — ${t.description || ''} (${t.scriptPath})`);
          }
        }
      }
      process.exit(0);
    }

    console.error(`Unknown command: ${command}`);
    printUsage();
    process.exit(1);
  } finally {
    loop.close();
  }
}

module.exports = {
  AgentLoop,
  DEFAULT_REGISTRY,
  DEFAULT_ROOT,
  hasUncommittedDiff
};

if (require.main === module) {
  main();
}
