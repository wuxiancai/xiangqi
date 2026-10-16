import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { chooseLocalMove, requestSuggestion } from '../src/ai.js';
import { applyMove, coord, initialBoard, legalMoves, RED, BLACK, toICCS } from '../src/rules.js';

test('the game setup defaults to the strongest local AI setting', async () => {
  const markup = await readFile(new URL('../index.html', import.meta.url), 'utf8');
  assert.match(markup, /<option value="max" selected>最强 · 最多搜索 6 层<\/option>/);
});

test('default and max strength avoid leaving a rook for a cannon capture', () => {
  const board = Array(90).fill(null);
  const put = (file, rank, piece) => { board[coord(file, rank)] = piece; };
  put(4, 9, 'K'); put(3, 0, 'k');
  put(0, 0, 'c'); put(0, 2, 'P'); put(0, 5, 'R');
  const stats = {};
  const move = chooseLocalMove(board, RED, undefined, stats);
  assert.equal(move.from, coord(0, 5));
  assert.ok(stats.depth > 1);
  const next = applyMove(board, move);
  assert.equal(legalMoves(next, BLACK).some((reply) => reply.to === move.to), false);
});

test('external AI suggestions must match a locally legal ICCS move', async () => {
  const originalFetch = globalThis.fetch;
  const board = initialBoard(); const moves = legalMoves(board, RED); const selected = moves[0];
  globalThis.fetch = async (_url, options) => {
    const request = JSON.parse(options.body);
    const candidates = JSON.parse(request.messages[1].content).legalMoves;
    assert.ok(candidates.some((move) => move.from === toICCS(selected.from) && move.to === toICCS(selected.to)));
    return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ from: toICCS(selected.from), to: toICCS(selected.to), explanation: '控制要点。' }) } }] }), { status: 200 });
  };
  try {
    const suggestion = await requestSuggestion({ board, side: RED, moves, settings: { apiUrl: 'https://ai.example/v1', apiKey: 'test-key', model: 'test-model' }, strength: 'beginner' });
    assert.deepEqual(suggestion.move, selected);
    assert.equal(suggestion.provider, 'external');
    assert.equal(suggestion.explanation, '控制要点。');
  } finally { globalThis.fetch = originalFetch; }
});

test('external AI output outside the legal move set is rejected', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify({ from: 'a0', to: 'a1', explanation: '不合法。' }) } }] }), { status: 200 });
  try {
    await assert.rejects(requestSuggestion({ board: initialBoard(), side: RED, moves: legalMoves(initialBoard(), RED), settings: { apiUrl: 'https://ai.example/v1', apiKey: 'test-key', model: 'test-model' }, strength: 'beginner' }), /不合法着法/);
  } finally { globalThis.fetch = originalFetch; }
});
