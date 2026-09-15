const assert = require('assert');
const { evaluateIntentGate, detectPonytail } = require('../src/agent/intentGate');

console.log('Running Intent Gate unit tests...');

const blocked = evaluateIntentGate('build a social platform');
assert.strictEqual(blocked.blocked, true);
assert.strictEqual(blocked.gate, 'grill-me');
assert.ok(blocked.questions.length >= 3);
console.log('✓ Test 1 Passed: Macro "build a platform" hard-stops for grill-me.');

const zhBlocked = evaluateIntentGate('做一个社交平台');
assert.strictEqual(zhBlocked.blocked, true, 'Chinese macro product request must block');
console.log('✓ Test 2 Passed: Chinese macro intent is blocked.');

const concrete = evaluateIntentGate('install sqlite native addon');
assert.strictEqual(concrete.blocked, false);
assert.strictEqual(concrete.reason, 'concrete-verb');
console.log('✓ Test 3 Passed: Concrete verbs are not grilled.');

const withTarget = evaluateIntentGate('build a platform adapter', { target: 'src/memory/db.js' });
assert.strictEqual(withTarget.blocked, false);
assert.strictEqual(withTarget.reason, 'has-target');
console.log('✓ Test 4 Passed: A file target bypasses the macro gate.');

const withPath = evaluateIntentGate('refactor src/graph/index.js callers');
assert.strictEqual(withPath.blocked, false);
console.log('✓ Test 5 Passed: A path in the intent is treated as specific.');

const forced = evaluateIntentGate('make an AI app', { force: true });
assert.strictEqual(forced.blocked, false);
console.log('✓ Test 6 Passed: --force / clarified intents skip the gate.');

const pony = detectPonytail('ponytail ultra slim this module');
assert.strictEqual(pony.active, true);
assert.strictEqual(pony.intensity, 'ultra');
assert.ok(pony.rungs.length === 7);
assert.strictEqual(detectPonytail('install sqlite').active, false);
console.log('✓ Test 7 Passed: Ponytail activates only on explicit lazy/YAGNI language.');

console.log('\nAll Intent Gate tests passed successfully!');
