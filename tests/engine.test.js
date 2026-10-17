import test from 'node:test';
import assert from 'node:assert/strict';
import { BLACK, RED, applyMove, fromICCS, initialBoard, legalMoves, sameMove } from '../src/rules.js';
import { boardToFen } from '../engine/pikafish/engine.js';

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
