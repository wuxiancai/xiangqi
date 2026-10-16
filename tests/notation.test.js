import test from 'node:test';
import assert from 'node:assert/strict';
import { BLACK, RED, coord, initialBoard } from '../src/rules.js';
import { chineseNotation } from '../src/notation.js';

test('formats red and black moves in Chinese chess notation', () => {
  const board = initialBoard();
  assert.equal(chineseNotation(board, { from: coord(7, 9), to: coord(6, 7) }, RED), '马二进三');
  assert.equal(chineseNotation(board, { from: coord(7, 7), to: coord(4, 7) }, RED), '炮二平五');
  assert.equal(chineseNotation(board, { from: coord(7, 2), to: coord(4, 2) }, BLACK), '炮8平5');
  assert.equal(chineseNotation(board, { from: coord(4, 6), to: coord(4, 5) }, RED), '兵五进一');
});

test('disambiguates same-file pieces by their advancement order', () => {
  const board = Array(90).fill(null);
  board[coord(4, 9)] = 'K';
  board[coord(4, 0)] = 'k';
  board[coord(0, 2)] = 'R';
  board[coord(0, 4)] = 'R';
  assert.equal(chineseNotation(board, { from: coord(0, 4), to: coord(0, 3) }, RED), '后车进一');
});
