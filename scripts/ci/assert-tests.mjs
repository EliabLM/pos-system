import { readFileSync } from 'node:fs';

const [path, runner] = process.argv.slice(2);
if (!path || !['vitest', 'playwright'].includes(runner)) {
  throw new Error('Usage: node assert-tests.mjs <json-file> <vitest|playwright>');
}
const payload = JSON.parse(readFileSync(path, 'utf8'));
const count = runner === 'vitest'
  ? (Array.isArray(payload) ? payload.length : 0)
  : (payload.suites ?? []).reduce(function visit(total, suite) {
      return total + (suite.specs ?? []).reduce((sum, spec) => sum + (spec.tests ?? []).length, 0)
        + (suite.suites ?? []).reduce(visit, 0);
    }, 0);
if (count < 1) throw new Error(`${runner}: no se descubrió ninguna prueba; CI debe fallar.`);
console.log(`${runner}: ${count} pruebas descubiertas.`);
