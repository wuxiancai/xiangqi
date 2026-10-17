import test from 'node:test';
import assert from 'node:assert/strict';
import { BLACK, RED, applyMove, fromICCS, initialBoard, legalMoves, sameMove } from '../src/rules.js';
import { boardToFen, formatRedEvaluation, parseUciInfoLine, toRedPerspective } from '../engine/pikafish/engine.js';

test('boardToFen encodes the symmetric initial position', () => {
  assert.equal(
    boardToFen(initialBoard(), RED),
    'rnbakabnr/9/1c5c1/p1p1p1p1p/9/9/P1P1P1P1P/1C5C1/9/RNBAKABNR w - - 0 1',
  );
});

test('boardToFen keeps piece ownership and rank orientation after asymmetric play', () => {
  const board = initialBoard();
  const moves = ['b7e7', 'b0c2', 'c6c5', 'g3g4', 'h9g7', 'h2h6'];
  for (const [index, text] of moves.entries()) {
    const move = { from: fromICCS(text.slice(0, 2)), to: fromICCS(text.slice(2)) };
    const side = index % 2 ? BLACK : RED;
    assert.ok(legalMoves(board, side).some((candidate) => sameMove(candidate, move)), `${text} should be legal`);
    board.splice(0, board.length, ...applyMove(board, move));
  }
  assert.equal(
    boardToFen(board, RED),
    'r1bakabnr/9/1cn6/p1p1p3p/6p2/2P6/P3P1PcP/4C1NC1/9/RNBAKAB1R w - - 0 1',
  );
});

test('parses Pikafish cp and WDL UCI scores', () => {
  assert.deepEqual(parseUciInfoLine('info depth 20 multipv 1 score cp 42 wdl 410 350 240 nodes 100 pv b2e2'), {
    depth: 20,
    multipv: 1,
    score: { type: 'cp', value: 42 },
    wdl: { win: 410, draw: 350, loss: 240 },
  });
});

test('normalizes score and WDL to red perspective for either side to move', () => {
  const line = { score: { type: 'cp', value: 42 }, wdl: { win: 410, draw: 350, loss: 240 } };
  assert.deepEqual(toRedPerspective(line, RED), line);
  assert.deepEqual(toRedPerspective(line, BLACK), {
    score: { type: 'cp', value: -42 },
    wdl: { win: 240, draw: 350, loss: 410 },
  });
});

test('formats red score in centipawns with win draw loss percentages', () => {
  const line = parseUciInfoLine('info depth 20 multipv 1 score cp 42 wdl 410 350 240 pv b2e2');
  assert.equal(formatRedEvaluation(line, RED), '红方 score cp +42 · WDL 胜 41% 和 35% 负 24%');
  assert.equal(formatRedEvaluation(line, BLACK), '红方 score cp -42 · WDL 胜 24% 和 35% 负 41%');
  assert.equal(formatRedEvaluation(null, RED), '红方 score cp — · WDL 胜 — 和 — 负 —');
});
