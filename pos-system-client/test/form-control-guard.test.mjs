/**
 * A33: <FormControl> passes id, aria-invalid and aria-describedby to its only
 * child (Radix Slot). Wrapping a <div> puts them on the div: the <label> no
 * longer points to the input and screen readers miss the error.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const SRC = new URL('../src', import.meta.url).pathname;
const WRAPPED_DIV = /<FormControl>\s*<div\b/;

function walk(dir) {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return name === 'generated' ? [] : walk(path);
    return name.endsWith('.tsx') ? [path] : [];
  });
}

test('guardián A33: el detector marca un FormControl que envuelve un div', () => {
  assert.ok(WRAPPED_DIV.test('<FormControl>\n  <div className="relative">'));
  assert.equal('<div className="relative">\n  <FormControl>\n    <Input />'.match(WRAPPED_DIV), null);
});

test('guardián A33: ningún FormControl envuelve un div', () => {
  const offenders = walk(SRC)
    .filter((file) => WRAPPED_DIV.test(readFileSync(file, 'utf8')))
    .map((file) => relative(SRC, file));
  assert.deepEqual(offenders, []);
});
