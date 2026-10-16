import test from 'node:test';
import assert from 'node:assert/strict';
import { convertTextToRecord } from '../src/importer.js';
import { validateAndReplay } from '../src/rules.js';

test('converts Chinese red/black notation into validated ICCS moves', () => {
  const record = convertTextToRecord('1. 炮二平五 马8进7', { title: '示例', sourceName: 'sample.txt' });
  assert.equal(record.schema, 'xiangqi-study/v1');
  assert.deepEqual(record.moves, [{ from: 'h7', to: 'e7' }, { from: 'h0', to: 'g2' }]);
  assert.equal(validateAndReplay(record).positions.length, 3);
});

test('converts ICCS coordinate notation', () => {
  const record = convertTextToRecord('a6a5 a3a4', { title: '', sourceName: 'game.iccs' });
  assert.deepEqual(record.moves, [{ from: 'a6', to: 'a5' }, { from: 'a3', to: 'a4' }]);
  assert.equal(record.title, 'game');
});

test('uses embedded FEN and its side-to-move when converting a position record', () => {
  const fen = '4k4/9/9/9/4R4/9/9/9/8R/4K4 w';
  const record = convertTextToRecord(`${fen}\n車一進一`, { title: '残局', sourceName: 'endgame.fen' });
  assert.deepEqual(record.initialPosition, { fen });
  assert.equal(record.moves.length, 1);
  assert.equal(validateAndReplay(record).positions.length, 2);
});

test('rejects unknown or illegal notations rather than importing partial records', () => {
  assert.throws(() => convertTextToRecord('1. 炮二平九', { title: 'bad', sourceName: 'bad.md' }), /无法匹配合法着法/);
  assert.throws(() => convertTextToRecord('没有着法', { title: 'empty', sourceName: 'empty.txt' }), /没有识别到棋谱着法/);
});
