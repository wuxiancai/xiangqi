import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { validateAndReplay } from '../src/rules.js';

test('built-in records are licensed, attributed, and all moves are legal', async () => {
  const records = JSON.parse(await readFile(new URL('../data/records/modern-games.json', import.meta.url), 'utf8'));
  for (const record of records) {
    assert.match(record.source.rights, /CC BY 4\.0/);
    assert.ok(record.source.url);
    validateAndReplay(record);
  }
  assert.ok(records.filter((record) => record.category.includes('现代对局')).length >= 30);
  assert.ok(records.filter((record) => record.category.includes('残局')).length >= 40);
});
