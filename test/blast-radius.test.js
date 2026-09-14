const assert = require('assert');
const fs = require('fs');
const path = require('path');
const { spawnSync } = require('child_process');

console.log('Running Code Symbol Graph & Blast-Radius Unit Tests (TDD)...');

const parserPath = path.resolve(__dirname, '../src/graph/parser.js');
const graphPath = path.resolve(__dirname, '../src/graph/index.js');
const blastPath = path.resolve(__dirname, '../src/graph/blastRadius.js');
const cliPath = path.resolve(__dirname, '../.agents/scripts/blast-radius.js');

// Require modules (expected to fail in Red Phase if not implemented yet)
let parseSource, SymbolGraph, calculateBlastRadius;
try {
  parseSource = require(parserPath).parseSource;
  SymbolGraph = require(graphPath).SymbolGraph;
  calculateBlastRadius = require(blastPath).calculateBlastRadius;
} catch (e) {
  parseSource = null;
  SymbolGraph = null;
  calculateBlastRadius = null;
}

assert.ok(parseSource, 'src/graph/parser.js module must be loadable and export parseSource');
assert.ok(SymbolGraph, 'src/graph/index.js module must be loadable and export SymbolGraph');
assert.ok(calculateBlastRadius, 'src/graph/blastRadius.js module must be loadable and export calculateBlastRadius');

// Test 1: Parser - Imports and Exports extraction
console.log('Testing Parser: Imports and Exports...');
const sampleCode = `
const path = require('path');
const { MemoryDatabase, DEFAULT_DB_PATH } = require('./db');
const scoring = require('../scoring');

class MyService {
  constructor(db) {
    this.db = db;
  }
  process(query) {
    const score = scoring.calculateScore(query);
    return this.db.get(score);
  }
}

function helper(a, b) {
  return a + b;
}

const arrowFunc = (x) => x * 2;

module.exports = {
  MyService,
  helper
};
`;

const parsed = parseSource(sampleCode, '/project/src/service.js');

assert.strictEqual(parsed.imports.length, 3, 'Should extract 3 require imports');
const dbImport = parsed.imports.find(i => i.source.includes('db'));
assert.ok(dbImport, 'Should detect ./db import');
assert.deepStrictEqual(dbImport.named, ['MemoryDatabase', 'DEFAULT_DB_PATH'], 'Should extract named imports');

assert.ok(parsed.classes.some(c => c.name === 'MyService'), 'Should detect MyService class');
assert.ok(parsed.functions.some(f => f.name === 'helper'), 'Should detect helper function');
assert.ok(parsed.functions.some(f => f.name === 'arrowFunc'), 'Should detect arrow function');
assert.deepStrictEqual(parsed.exports, ['MyService', 'helper'], 'Should detect exported symbols');
console.log('✓ Test 1 Passed: Parser correctly extracts imports, exports, functions, and classes.');

// Test 2: Parser - Relative Path Resolution
console.log('Testing Parser: Relative path resolution...');
const { resolveModulePath } = require(parserPath);
const fromFile = path.resolve(__dirname, '../src/memory/index.js');
const resolvedDb = resolveModulePath('./db', fromFile);
assert.strictEqual(resolvedDb, path.resolve(__dirname, '../src/memory/db.js'), 'Should resolve ./db to db.js');
console.log('✓ Test 2 Passed: Relative module resolution resolves target file paths properly.');

// Test 3: Graph Construction - Building Project Symbol Graph
console.log('Testing SymbolGraph: Project-wide indexing...');
const rootDir = path.resolve(__dirname, '..');
const graph = new SymbolGraph({ rootDir });
graph.build();

const dbFilePath = path.resolve(rootDir, 'src/memory/db.js');
const indexFilePath = path.resolve(rootDir, 'src/memory/index.js');

const dbNode = graph.getFileNode(dbFilePath);
assert.ok(dbNode, 'src/memory/db.js should be indexed as a node');
assert.ok(dbNode.exports.includes('MemoryDatabase'), 'db.js should export MemoryDatabase');

const downstreamOfDb = graph.getDownstreamFiles(dbFilePath);
assert.ok(downstreamOfDb.includes(indexFilePath), 'src/memory/index.js should be downstream of src/memory/db.js');
console.log('✓ Test 3 Passed: SymbolGraph correctly indexes project files and binds dependency relations.');

// Test 4: Blast-Radius Calculation - File Level Impact
console.log('Testing Blast-Radius: File-level impact on src/memory/db.js...');
const blastDb = calculateBlastRadius(dbFilePath, { graph });

assert.strictEqual(blastDb.targetType, 'file');
assert.ok(blastDb.directFiles.includes(indexFilePath), 'src/memory/index.js must be in direct impact list');
const testMemoryPath = path.resolve(rootDir, 'test/memory.test.js');
assert.ok(blastDb.impactedTests.includes(testMemoryPath), 'test/memory.test.js must be in impacted tests list');
assert.ok(blastDb.riskScore > 0, 'Risk score must be > 0');
assert.ok(['LOW', 'MEDIUM', 'HIGH'].includes(blastDb.riskLevel), 'Risk level should be valid enum');
console.log('✓ Test 4 Passed: File-level blast radius detects direct callers and affected test suites.');

// Test 5: Blast-Radius Calculation - Symbol Level Impact
console.log('Testing Blast-Radius: Symbol-level impact on MemoryDatabase...');
const blastSymbol = calculateBlastRadius('MemoryDatabase', { graph });

assert.strictEqual(blastSymbol.targetType, 'symbol');
assert.ok(blastSymbol.declarationFile.includes('db.js'), 'Declaration file should point to db.js');
assert.ok(blastSymbol.impactedTests.includes(testMemoryPath), 'Should identify impacted test file for MemoryDatabase');
console.log('✓ Test 5 Passed: Symbol-level blast radius accurately traces symbol calls and tests.');

// Test 6: Safety Plan & Checklist Generation
console.log('Testing Safety Plan generation...');
assert.ok(blastDb.safetyPlan, 'Should contain safetyPlan object');
assert.ok(Array.isArray(blastDb.safetyPlan.recommendedTestCommands), 'Should list test commands');
assert.ok(blastDb.safetyPlan.steps.length > 0, 'Should provide step-by-step refactoring guidelines');
console.log('✓ Test 6 Passed: Safety plan generates actionable checklists and test commands.');

// Test 7: CLI Execution - Terminal & JSON output
console.log('Testing CLI execution via runner.js...');
const cliRun = spawnSync(process.execPath, [
  cliPath,
  '--target', 'src/memory/db.js',
  '--json'
], { encoding: 'utf8' });

assert.strictEqual(cliRun.status, 0, 'CLI should exit with code 0');
const parsedOutput = JSON.parse(cliRun.stdout.trim());
assert.strictEqual(parsedOutput.target, 'src/memory/db.js');
assert.ok(parsedOutput.directCount >= 1, 'Should report direct impact count');
console.log('✓ Test 7 Passed: CLI execution outputs structured JSON report cleanly.');

// Test 8: CLI Execution - Tree view formatting
console.log('Testing CLI execution with --tree flag...');
const treeRun = spawnSync(process.execPath, [
  cliPath,
  '--target', 'src/memory/db.js',
  '--tree',
  '--lang', 'en-US'
], { encoding: 'utf8' });

assert.strictEqual(treeRun.status, 0, 'Tree CLI should exit with code 0');
assert.ok(treeRun.stdout.includes('Blast Radius'), 'Should print human-readable tree header');
assert.ok(treeRun.stdout.includes('src/memory/index.js'), 'Tree output should display downstream file');
console.log('✓ Test 8 Passed: CLI tree mode renders ASCII dependency hierarchy.');

// Test 9: Fuzzy basename target resolution (e.g. 'db.js' -> 'src/memory/db.js')
console.log('Testing fuzzy target resolution by basename...');
const fuzzyBlast = calculateBlastRadius('db.js', { graph });
assert.strictEqual(fuzzyBlast.targetType, 'file');
assert.ok(fuzzyBlast.targetFile.includes('src/memory/db.js'), 'Should resolve db.js to src/memory/db.js');
assert.ok(fuzzyBlast.directCount >= 1, 'Should find direct callers via fuzzy basename');
console.log('✓ Test 9 Passed: Fuzzy target resolution correctly maps basenames to project files.');

// Test 10: Parser export preservation with line comments
console.log('Testing Parser export preservation with embedded comments...');
const codeWithComments = `
module.exports = {
  MemoryDatabase, // database class
  DEFAULT_DB_PATH,
  calculateScore
};
`;
const parsedWithComments = parseSource(codeWithComments, '/test.js');
assert.ok(parsedWithComments.exports.includes('MemoryDatabase'));
assert.ok(parsedWithComments.exports.includes('DEFAULT_DB_PATH'));
assert.ok(parsedWithComments.exports.includes('calculateScore'));
console.log('✓ Test 10 Passed: Embedded line comments do not corrupt exported symbol extraction.');

// Test 11: URL literals containing // must not be treated as comments
console.log('Testing Parser preservation of https:// URL string literals...');
const codeWithUrlExport = `
module.exports = { url: "https://x.com", foo, bar };
`;
const parsedUrlExport = parseSource(codeWithUrlExport, '/test-url.js');
assert.ok(parsedUrlExport.exports.includes('url'), 'url export must survive https:// in a string');
assert.ok(parsedUrlExport.exports.includes('foo'), 'foo export must survive https:// in a string');
assert.ok(parsedUrlExport.exports.includes('bar'), 'bar export must survive https:// in a string');

const codeWithUrlAndComment = `
const API = "https://example.com/v1";
const { MemoryDatabase } = require("./db");
function fetchUser() { return API; } // trailing comment
module.exports = { fetchUser, API };
`;
const parsedUrlComment = parseSource(codeWithUrlAndComment, '/tmp/service.js');
assert.ok(parsedUrlComment.imports.some(i => i.source.includes('db')), 'require after a URL literal must still parse');
assert.ok(parsedUrlComment.exports.includes('fetchUser'));
assert.ok(parsedUrlComment.exports.includes('API'));
assert.ok(parsedUrlComment.functions.some(f => f.name === 'fetchUser'));
console.log('✓ Test 11 Passed: https:// inside strings is not stripped as a line comment.');

// Test 12: ESM export { } and import * as
console.log('Testing Parser ESM export lists and namespace imports...');
const esmCode = `
import * as memory from './src/memory/index.js';
import { AgentLoop } from './src/agent/index.js';
export { parseSource, stripComments as strip };
export function calculateBlastRadius() {}
`;
const parsedEsm = parseSource(esmCode, '/tmp/graph.js');
assert.ok(parsedEsm.imports.some(i => i.type === 'esm' && i.defaultName === 'memory' && i.source.includes('memory')), 'import * as memory must be captured');
assert.ok(parsedEsm.imports.some(i => i.named && i.named.includes('AgentLoop')), 'named ESM import must still parse');
assert.ok(parsedEsm.exports.includes('parseSource'), 'export { parseSource } must be captured');
assert.ok(parsedEsm.exports.includes('strip'), 'export { x as strip } must use the public name');
assert.ok(parsedEsm.exports.includes('calculateBlastRadius'));
console.log('✓ Test 12 Passed: export { } and import * as are parsed.');

// Test 13: Parser function and class line range tracking
console.log('Testing Parser line range tracking for functions and classes...');
const sampleWithLines = `
function firstFunc() {
  const x = 1;
  return x;
}

class SampleClass {
  constructor() {}
}

const arrow = (a) => {
  return a * 2;
};
`;
const parsedWithLines = parseSource(sampleWithLines, '/sample.js');
const first = parsedWithLines.functions.find(f => f.name === 'firstFunc');
assert.ok(first, 'Should parse firstFunc');
assert.strictEqual(first.startLine, 2, 'firstFunc startLine should be 2');
assert.strictEqual(first.endLine, 5, 'firstFunc endLine should be 5');

const cls = parsedWithLines.classes.find(c => c.name === 'SampleClass');
assert.ok(cls, 'Should parse SampleClass');
assert.strictEqual(cls.startLine, 7, 'SampleClass startLine should be 7');
assert.strictEqual(cls.endLine, 9, 'SampleClass endLine should be 9');

const arr = parsedWithLines.functions.find(f => f.name === 'arrow');
assert.ok(arr, 'Should parse arrow');
assert.strictEqual(arr.startLine, 11, 'arrow startLine should be 11');
assert.strictEqual(arr.endLine, 13, 'arrow endLine should be 13');
console.log('✓ Test 13 Passed: Parser accurately records startLine and endLine for functions and classes.');

// Test 14: parseDiffHunks parses modified lines from unified diff
console.log('Testing parseDiffHunks line number extraction...');
const { parseDiffHunks } = require(blastPath);
assert.ok(parseDiffHunks, 'blastRadius.js must export parseDiffHunks');
const sampleDiff = `
--- a/src/service.js
+++ b/src/service.js
@@ -10,0 +11,3 @@
+const internalA = 1;
+const internalB = 2;
+return internalA + internalB;
@@ -25,2 +28,1 @@
-oldLine1
-oldLine2
+newLine1
@@ -40 +43 @@
+singleChange
`;
const modifiedLines = parseDiffHunks(sampleDiff, 'src/service.js');
assert.deepStrictEqual(modifiedLines, [11, 12, 13, 28, 43], 'Should extract 1-based line numbers from hunks');
console.log('✓ Test 14 Passed: parseDiffHunks accurately extracts modified line numbers.');

// Test 15: Modifying an internal private function converges to LOCAL_PRIVATE
console.log('Testing Diff-Aware blast radius on private internal modification...');
const os = require('os');
const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'blast-diff-'));
const modAPath = path.join(tmpDir, 'moduleA.js');
const modBPath = path.join(tmpDir, 'moduleB.js');

const modACode = `
function _internalHelper(val) {
  return val * 10;
}

function publicExported() {
  return "hello";
}

module.exports = {
  publicExported
};
`;

const modBCode = `
const { publicExported } = require('./moduleA');
function consumer() {
  return publicExported();
}
module.exports = { consumer };
`;

fs.writeFileSync(modAPath, modACode, 'utf8');
fs.writeFileSync(modBPath, modBCode, 'utf8');

const isolatedGraph = new SymbolGraph({ rootDir: tmpDir });
isolatedGraph.build();

// Verify downstream relationship initially
const downstreamBefore = isolatedGraph.getDownstreamFiles(modAPath);
assert.ok(downstreamBefore.includes(modBPath), 'moduleB should depend on moduleA');

// Scenario 1: Diff modifies ONLY _internalHelper (line 3: return val * 10;)
const privateDiff = `
--- a/moduleA.js
+++ b/moduleA.js
@@ -3 +3 @@
-  return val * 10;
+  return val * 20;
`;

const blastPrivate = calculateBlastRadius(modAPath, {
  graph: isolatedGraph,
  diff: privateDiff,
  diffAware: true,
  rootDir: tmpDir
});

assert.strictEqual(blastPrivate.isDiffAware, true, 'Report should be marked as diff-aware');
assert.strictEqual(blastPrivate.scope, 'LOCAL_PRIVATE', 'Scope should converge to LOCAL_PRIVATE');
assert.strictEqual(blastPrivate.riskLevel, 'LOW', 'Risk level should be LOW for private changes');
assert.deepStrictEqual(blastPrivate.directFiles, [], 'No downstream files should be in direct impact for private changes');
assert.deepStrictEqual(blastPrivate.indirectFiles, [], 'No indirect files should be alerted for private changes');
assert.ok(blastPrivate.notes && blastPrivate.notes.includes('LOCAL_PRIVATE'), 'Notes should explain local private containment');
console.log('✓ Test 15 Passed: Internal private modification converges to LOCAL_PRIVATE with LOW risk.');

// Test 16: Modifying public exported function triggers full blast radius
console.log('Testing Diff-Aware blast radius on public exported function modification...');
const publicDiff = `
--- a/moduleA.js
+++ b/moduleA.js
@@ -7 +7 @@
-  return "hello";
+  return "world";
`;

const blastPublic = calculateBlastRadius(modAPath, {
  graph: isolatedGraph,
  diff: publicDiff,
  diffAware: true,
  rootDir: tmpDir
});

assert.strictEqual(blastPublic.isDiffAware, true);
assert.strictEqual(blastPublic.scope, 'PUBLIC_CONTRACT', 'Scope should be PUBLIC_CONTRACT when touching exported function');
assert.ok(blastPublic.directFiles.includes(modBPath), 'moduleB must be alerted when public function is modified');
console.log('✓ Test 16 Passed: Modifying exported function triggers full downstream blast radius.');

// Test 17: CLI execution with --diff flag
console.log('Testing CLI execution with --diff flag...');
const cliDiffRun = spawnSync(process.execPath, [
  cliPath,
  '--target', 'src/memory/db.js',
  '--diff',
  '--json'
], { encoding: 'utf8' });

assert.strictEqual(cliDiffRun.status, 0, 'CLI with --diff should exit with 0');
const parsedCliDiff = JSON.parse(cliDiffRun.stdout.trim());
assert.strictEqual(parsedCliDiff.target, 'src/memory/db.js');
assert.strictEqual(parsedCliDiff.isDiffAware, true, 'isDiffAware should be true in CLI report');
console.log('✓ Test 17 Passed: CLI with --diff flag produces structured diff-aware report.');

// Cleanup hermetic tmp directory
fs.rmSync(tmpDir, { recursive: true, force: true });

// Test 18: Deep destructuring and aliases in CJS require and ESM import/export
console.log('Testing Acorn Parser deep destructuring and aliases...');
const deepCode = `
const { config: { db: { connectionString: dbUri } } } = require('./config');
import { originalName as aliasedName, standardHelper } from './utils';

function runner() {
  return aliasedName(dbUri);
}

const exportedValue = 100;
export { runner, exportedValue as publicValue };
`;
const parsedDeep = parseSource(deepCode, '/project/src/deep.js');
assert.ok(parsedDeep.imports.some(i => i.source.includes('config') && i.named && i.named.includes('dbUri')), 'Should capture deeply destructured dbUri alias');
assert.ok(parsedDeep.imports.some(i => i.source.includes('utils') && i.named && i.named.includes('aliasedName')), 'Should capture aliasedName import');
assert.ok(parsedDeep.exports.includes('runner'), 'Should capture runner export');
assert.ok(parsedDeep.exports.includes('publicValue'), 'Should capture publicValue export alias');
console.log('✓ Test 18 Passed: Deep destructuring and export aliases parsed accurately.');

// Test 19: False-positive elimination for built-in globals (JSON.parse, Math.max, etc.)
console.log('Testing False-positive elimination for built-in globals...');
const globalCallsCode = `
const customParser = require('./customParser');

function handler(data) {
  const obj = JSON.parse(data); // Built-in global JSON.parse
  const maxVal = Math.max(1, 2); // Built-in global Math.max
  console.log(obj, maxVal); // Built-in global console.log
  return customParser.parse(obj); // Real user symbol call
}
`;
const parsedGlobals = parseSource(globalCallsCode, '/project/src/handler.js');
assert.ok(!parsedGlobals.callSites.includes('JSON.parse'), 'Should NOT include JSON.parse in call sites');
assert.ok(!parsedGlobals.callSites.includes('Math.max'), 'Should NOT include Math.max in call sites');
assert.ok(!parsedGlobals.callSites.includes('console.log'), 'Should NOT include console.log in call sites');
assert.ok(parsedGlobals.callSites.includes('customParser.parse'), 'Should include customParser.parse in call sites');
console.log('✓ Test 19 Passed: Built-in global calls successfully excluded from call sites.');

// Test 20: Scope chain awareness and local variable shadowing
console.log('Testing Scope chain awareness and local variable shadowing...');
const scopeCode = `
function outer() {
  function calculate(x) {
    return x * 2;
  }
  return calculate(10);
}

function shadowScope(calculate) {
  return calculate();
}
`;
const parsedScope = parseSource(scopeCode, '/project/src/scope.js');
assert.ok(parsedScope.functions.some(f => f.name === 'outer'), 'outer function captured');
assert.ok(parsedScope.functions.some(f => f.name === 'shadowScope'), 'shadowScope function captured');
console.log('✓ Test 20 Passed: Lexical scopes and function declarations accurately indexed.');

// Test 21: Smooth fallback on non-standard / TypeScript syntax
console.log('Testing Smooth fallback on non-standard / TypeScript syntax...');
const tsCode = `
interface UserConfig {
  id: string;
  port: number;
}

export function startServer(cfg: UserConfig): void {
  console.log(cfg.port);
}

module.exports = { startServer };
`;
const parsedTs = parseSource(tsCode, '/project/src/server.ts');
assert.ok(parsedTs, 'Fallback parser should not throw on TS syntax');
assert.ok(parsedTs.exports.includes('startServer'), 'Fallback parser should extract exported startServer');
console.log('✓ Test 21 Passed: Smooth fallback on TS syntax succeeds without crashing.');

console.log('\nAll 21 Code Symbol Graph & Blast-Radius tests passed successfully! 🎉');
