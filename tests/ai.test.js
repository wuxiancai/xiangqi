import test from 'node:test';
import assert from 'node:assert/strict';
import { requestSuggestion } from '../src/ai.js';
import { initialBoard, legalMoves, RED, toICCS } from '../src/rules.js';

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
