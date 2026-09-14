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

console.log('\nAll 10 Code Symbol Graph & Blast-Radius tests passed successfully! 🎉');
