import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { convertTextToRecord, extractText, importXqfFolderFiles, MAX_IMPORT_SIZE } from '../src/importer.js';
import { parseXqf, xqfMovesAsText } from '../src/xqf.js';
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

test('accepts files up to 500 MiB and rejects larger imports', async () => {
  assert.equal(MAX_IMPORT_SIZE, 500 * 1024 * 1024);
  const boundaryFile = { name: 'boundary.txt', size: MAX_IMPORT_SIZE, text: async () => '1. 炮二平五' };
  assert.equal(await extractText(boundaryFile), '1. 炮二平五');
  const oversizedFile = { ...boundaryFile, size: MAX_IMPORT_SIZE + 1 };
  await assert.rejects(extractText(oversizedFile), /文件超过 500 MiB 上限/);
});

test('decodes an XQF 1.0 mainline and converts its move to a legal internal record', () => {
  const bytes = new Uint8Array(1024 + 24);
  bytes.set([0x58, 0x51, 0x0a]);
  bytes[0x40] = 0;
  bytes.set([0x18, 0x20, 0xf0, 0xff], 1024);
  bytes.set([47, 56, 0, 0], 1032);
  const parsed = parseXqf(bytes.buffer, 'opening.xqf');
  assert.equal(parsed.moves.length, 1);
  assert.equal(parsed.moves[0].from, 'c6');
  assert.equal(parsed.moves[0].to, 'c5');
  const record = convertTextToRecord(xqfMovesAsText(parsed), { title: parsed.title, sourceName: 'opening.xqf' });
  assert.equal(record.initialPosition.fen.endsWith(' w'), true);
  assert.deepEqual(record.moves, [{ from: 'c6', to: 'c5' }]);
  assert.equal(validateAndReplay(record).positions.length, 2);
});

test('rejects truncated or invalid XQF data', () => {
  assert.throws(() => parseXqf(new ArrayBuffer(32)), /文件头无效/);
  const bytes = new Uint8Array(1032);
  bytes.set([0x58, 0x51, 0x0a]);
  assert.throws(() => parseXqf(bytes.buffer), /XQF 文件没有棋谱着法/);
});

test('decrypts a version 1.1 XQF move stream', () => {
  const bytes = new Uint8Array(1024 + 8);
  bytes.set([0x58, 0x51, 0x0b]);
  bytes.set([1, 2, 3, 4], 8);
  const key = [1, 2, 3, 4];
  const mask = '[(C) Copyright Mr. Dong Shiwei.]';
  const stream = Array.from({ length: 32 }, (_, index) => key[index % 4] & mask.charCodeAt(index));
  const offset = { index: 1024, stream: 0 };
  const encode = (values) => values.forEach((value) => {
    bytes[offset.index] = (value + stream[offset.stream]) & 0xff;
    offset.index += 1;
    offset.stream = (offset.stream + 1) % 32;
  });
  encode([0x18, 0x20, 0x80, 0xff]);
  encode([47, 56, 0, 0]);
  const parsed = parseXqf(bytes.buffer);
  assert.deepEqual(parsed.moves.map(({ from, to }) => [from, to]), [['c6', 'c5']]);
});

test('extractText recognizes XQF binary files without text decoding', async () => {
  const bytes = new Uint8Array(1048);
  bytes.set([0x58, 0x51, 0x0a]);
  bytes.set([0x18, 0x20, 0xf0, 0xff], 1024);
  bytes.set([47, 56, 0, 0], 1032);
  const text = await extractText({ name: 'opening.XQF', size: bytes.byteLength, arrayBuffer: async () => bytes.buffer });
  assert.match(text, /\bc6c5\b/);
});

test('imports nested folder XQF files in batches, skipping invalid files and repeated paths', async () => {
  const createFile = (name, relativePath, valid = true) => {
    const bytes = new Uint8Array(valid ? 1048 : 32);
    if (valid) {
      bytes.set([0x58, 0x51, 0x0a]);
      bytes.set([0x18, 0x20, 0xf0, 0xff], 1024);
      bytes.set([47, 56, 0, 0], 1032);
    }
    return { name, webkitRelativePath: relativePath, size: bytes.byteLength, arrayBuffer: async () => bytes.buffer };
  };
  const files = [
    createFile('first.XQF', 'collection/first.XQF'),
    createFile('nested.xqf', 'collection/subfolder/nested.xqf'),
    createFile('broken.xqf', 'collection/subfolder/broken.xqf', false),
    { name: 'readme.txt', webkitRelativePath: 'collection/readme.txt', size: 4 },
  ];
  const progress = [];
  const result = await importXqfFolderFiles(files, [], (item) => progress.push(item));
  assert.equal(result.total, 3);
  assert.equal(result.records.length, 2);
  assert.equal(result.failures.length, 1);
  assert.equal(result.records[1].source.name, 'collection/subfolder/nested.xqf');
  assert.equal(progress.length, 3);
  const repeated = await importXqfFolderFiles(files.slice(0, 2), result.records);
  assert.equal(repeated.records.length, 0);
  assert.equal(repeated.duplicates, 2);
});

test('folder import picker includes directories, nested files, and XQF only', async () => {
  const html = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  const app = await readFile(new URL('../src/app.js', import.meta.url), 'utf8');
  assert.match(html, /id="import-folder"[^>]*webkitdirectory[^>]*directory[^>]*multiple[^>]*accept="\.xqf"/);
  assert.match(app, /#import-folder'\)\.addEventListener\('change', \(event\) => importXqfFolder\(event\.target\.files\)\)/);
});
