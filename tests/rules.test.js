import test from 'node:test';
import assert from 'node:assert/strict';
import { BLACK, RED, capturablePieces, coord, fromICCS, initialBoard, isInCheck, legalMoves, gameStatus, applyMove, parseFEN, pieceThreatStatus, toICCS, validateAndReplay } from '../src/rules.js';
import { adjudicateRepetition } from '../src/repetition.js';

test('three repeated cycles of unilateral perpetual check lose, while mutual checking does not trigger this ruling', () => {
  const trace = [{ key: 'A' }];
  for (let cycle = 0; cycle < 3; cycle += 1) {
    trace.push({ key: 'B', mover: RED, gaveCheck: true });
    trace.push({ key: 'A', mover: BLACK, gaveCheck: false });
  }
  assert.deepEqual(adjudicateRepetition(trace), { over: true, loser: RED, winner: BLACK, reason: '长将判负' });
  assert.equal(adjudicateRepetition(trace.slice(0, 5)), null);
  assert.equal(adjudicateRepetition(trace.map((entry) => entry.mover === BLACK ? { ...entry, gaveCheck: true } : entry)), null);
});

function emptyBoard() { return Array(90).fill(null); }
function put(board, file, rank, piece) { board[coord(file, rank)] = piece; }
function move(board, fromFile, fromRank, toFile, toRank, side) {
  return legalMoves(board, side).some((item) => item.from === coord(fromFile, fromRank) && item.to === coord(toFile, toRank));
}

test('standard setup contains 32 pieces and ICCS coordinates round-trip', () => {
  const board = initialBoard();
  assert.equal(board.filter(Boolean).length, 32);
  assert.equal(toICCS(fromICCS('e9')), 'e9');
  assert.throws(() => fromICCS('j2'), /无效/);
});

test('capturable piece squares include legal captures and checked generals', () => {
  const board = emptyBoard();
  put(board, 4, 9, 'K'); put(board, 3, 0, 'k');
  put(board, 0, 0, 'r'); put(board, 0, 5, 'H'); put(board, 4, 5, 'P');
  const threatened = capturablePieces(board);
  assert.ok(threatened.has(coord(0, 5)));

  const checkedBoard = emptyBoard();
  put(checkedBoard, 4, 9, 'K'); put(checkedBoard, 3, 0, 'k');
  put(checkedBoard, 4, 0, 'r');
  assert.ok(capturablePieces(checkedBoard).has(coord(4, 9)));
});

test('a piece with a legal friendly recapture is not marked as hanging', () => {
  const board = emptyBoard();
  put(board, 4, 9, 'K'); put(board, 3, 0, 'k');
  put(board, 4, 5, 'P'); put(board, 1, 0, 'r');
  put(board, 1, 9, 'H'); put(board, 0, 9, 'R');
  assert.ok(legalMoves(board, BLACK).some((move) => move.from === coord(1, 0) && move.to === coord(1, 9)));
  assert.equal(capturablePieces(board).has(coord(1, 9)), false);
});

test('threat display distinguishes protected pieces from exposed pieces', () => {
  const board = emptyBoard();
  put(board, 4, 9, 'K'); put(board, 3, 0, 'k');
  put(board, 0, 0, 'r'); put(board, 0, 5, 'H');
  assert.equal(pieceThreatStatus(board).get(coord(0, 5)), 'exposed');

  put(board, 0, 9, 'R');
  assert.equal(pieceThreatStatus(board).get(coord(0, 5)), 'protected');
  assert.equal(capturablePieces(board).has(coord(0, 5)), false);
});

test('rook cannot pass a blocker, cannon needs exactly one screen to capture', () => {
  const board = emptyBoard(); put(board, 4, 9, 'K'); put(board, 3, 0, 'k');
  put(board, 0, 9, 'R'); put(board, 0, 7, 'P'); put(board, 0, 5, 'c');
  assert.equal(move(board, 0, 9, 0, 5, RED), false);
  put(board, 2, 7, 'C'); put(board, 2, 6, 'P'); put(board, 2, 3, 'r');
  assert.equal(move(board, 2, 7, 2, 3, RED), true);
  put(board, 2, 5, 'P');
  assert.equal(move(board, 2, 7, 2, 3, RED), false);
});

test('horse legs, elephant eyes, river boundary and palace restrictions are enforced', () => {
  const board = emptyBoard(); put(board, 4, 9, 'K'); put(board, 3, 0, 'k'); put(board, 4, 4, 'H'); put(board, 5, 4, 'P');
  assert.equal(move(board, 4, 4, 6, 5, RED), false);
  board[coord(5, 4)] = null;
  assert.equal(move(board, 4, 4, 6, 5, RED), true);
  put(board, 2, 9, 'E'); put(board, 3, 8, 'P');
  assert.equal(move(board, 2, 9, 4, 7, RED), false);
  board[coord(3, 8)] = null;
  assert.equal(move(board, 2, 9, 4, 7, RED), true);
  assert.equal(move(board, 2, 9, 0, 7, RED), true);
  put(board, 4, 7, 'E');
  assert.equal(move(board, 4, 7, 6, 9, RED), true);
  put(board, 2, 5, 'E');
  assert.equal(move(board, 2, 5, 4, 3, RED), false);
  put(board, 3, 9, 'A');
  assert.equal(move(board, 3, 9, 4, 8, RED), true);
  assert.equal(move(board, 3, 9, 2, 8, RED), false);
});

test('soldier gains sideways moves after crossing the river but never moves backward', () => {
  const board = emptyBoard(); put(board, 4, 9, 'K'); put(board, 3, 0, 'k'); put(board, 4, 5, 'P');
  assert.equal(move(board, 4, 5, 3, 5, RED), false);
  assert.equal(move(board, 4, 5, 4, 4, RED), true);
  put(board, 4, 4, 'P'); board[coord(4, 5)] = null;
  assert.equal(move(board, 4, 4, 3, 4, RED), true);
  assert.equal(move(board, 4, 4, 4, 5, RED), false);
});

test('generals cannot face each other or move into check', () => {
  const board = emptyBoard(); put(board, 4, 9, 'K'); put(board, 4, 0, 'k');
  assert.equal(isInCheck(board, RED), true);
  put(board, 4, 5, 'P');
  assert.equal(isInCheck(board, RED), false);
  board[coord(4, 5)] = null; put(board, 4, 8, 'r'); put(board, 0, 8, 'R');
  assert.equal(move(board, 0, 8, 0, 7, RED), false);
});

test('checkmate and stalemate both end the game, with distinct reasons', () => {
  const mate = emptyBoard(); put(mate, 4, 9, 'K'); put(mate, 4, 0, 'k'); put(mate, 3, 1, 'R'); put(mate, 5, 1, 'R'); put(mate, 4, 1, 'R');
  const mateStatus = gameStatus(mate, BLACK);
  assert.equal(mateStatus.over, true); assert.equal(mateStatus.reason, '将死'); assert.equal(mateStatus.winner, RED);
  const stalemate = emptyBoard(); put(stalemate, 4, 9, 'K'); put(stalemate, 4, 0, 'k'); put(stalemate, 4, 5, 'P'); put(stalemate, 3, 1, 'R'); put(stalemate, 5, 1, 'R');
  const staleStatus = gameStatus(stalemate, BLACK);
  assert.equal(staleStatus.over, true); assert.equal(staleStatus.reason, '困毙'); assert.equal(staleStatus.winner, RED);
});

test('legality rejects moving into check and allows a valid move without mutating source', () => {
  const board = emptyBoard(); put(board, 4, 9, 'K'); put(board, 4, 0, 'k'); put(board, 4, 8, 'r'); put(board, 0, 8, 'R');
  const before = board.slice();
  assert.equal(move(board, 0, 8, 0, 7, RED), false);
  const next = applyMove(board, { from: coord(0, 8), to: coord(0, 7) });
  assert.notDeepEqual(next, board); assert.deepEqual(board, before);
});

test('record import rejects invalid schema and reports the failing ply', () => {
  assert.throws(() => validateAndReplay({ schema: 'nope' }), /schema/);
  const record = { schema: 'xiangqi-study/v1', id: 'x', title: '测试谱', category: ['古谱'], players: { red: '红', black: '黑' }, result: '未完', source: { name: '测试', rights: '待核实' }, initialPosition: 'standard', moves: [{ from: 'a0', to: 'a1' }], annotations: {}, tags: [] };
  assert.throws(() => validateAndReplay(record), /第 1 着/);
});

test('custom FEN positions preserve the initial side and support endgame records', () => {
  const fen = '4k4/9/9/9/9/4P4/9/9/9/4K4 b - - 0 1';
  const initial = parseFEN(fen);
  assert.equal(initial.side, BLACK);
  const record = {
    schema: 'xiangqi-study/v1', id: 'fen-endgame', title: 'FEN残局示例', category: ['残局'],
    players: { red: '红', black: '黑' }, result: '未完', source: { name: '测试', rights: 'CC0-1.0' },
    initialPosition: { fen }, moves: [{ from: 'e0', to: 'd0' }], annotations: {}, tags: [],
  };
  const parsed = validateAndReplay(record);
  assert.equal(parsed.initialSide, BLACK);
  assert.equal(parsed.positions.length, 2);
  assert.equal(parsed.positions[0][coord(4, 0)], 'k');
});
