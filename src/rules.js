export const FILES = 9;
export const RANKS = 10;
export const RED = 'red';
export const BLACK = 'black';
export const otherSide = (side) => side === RED ? BLACK : RED;
export const sideOf = (piece) => piece ? (piece === piece.toUpperCase() ? RED : BLACK) : null;
export const kindOf = (piece) => piece?.toUpperCase();
export const coord = (file, rank) => rank * FILES + file;
export const fileOf = (square) => square % FILES;
export const rankOf = (square) => Math.floor(square / FILES);
export const toICCS = (square) => `${String.fromCharCode(97 + fileOf(square))}${rankOf(square)}`;
export function fromICCS(value) {
  if (typeof value !== 'string' || !/^[a-i][0-9]$/.test(value)) throw new Error(`无效的 ICCS 坐标：${value}`);
  return coord(value.charCodeAt(0) - 97, Number(value[1]));
}

export function initialBoard() {
  const board = Array(90).fill(null);
  const back = ['r', 'h', 'e', 'a', 'k', 'a', 'e', 'h', 'r'];
  for (let file = 0; file < FILES; file += 1) {
    board[coord(file, 0)] = back[file];
    board[coord(file, 9)] = back[file].toUpperCase();
  }
  for (const file of [1, 7]) {
    board[coord(file, 2)] = 'c';
    board[coord(file, 7)] = 'C';
  }
  for (const file of [0, 2, 4, 6, 8]) {
    board[coord(file, 3)] = 'p';
    board[coord(file, 6)] = 'P';
  }
  return board;
}

export function parseFEN(fen) {
  if (typeof fen !== 'string') throw new Error('初始局面 FEN 必须是文本');
  const [placement, activeColor] = fen.trim().split(/\s+/);
  if (!placement || !['w', 'b'].includes(activeColor)) throw new Error('FEN 必须包含局面与 w/b 行棋方');
  const rows = placement.split('/');
  if (rows.length !== RANKS) throw new Error('FEN 必须包含 10 横线');
  const fenPieces = { r: 'r', n: 'h', b: 'e', a: 'a', k: 'k', c: 'c', p: 'p' };
  const board = Array(90).fill(null);
  rows.forEach((row, rank) => {
    let file = 0;
    for (const char of row) {
      if (/^[1-9]$/.test(char)) file += Number(char);
      else {
        const piece = fenPieces[char.toLowerCase()];
        if (!piece || file >= FILES) throw new Error(`FEN 第 ${rank + 1} 横线棋子无效`);
        board[coord(file, rank)] = char === char.toUpperCase() ? piece.toUpperCase() : piece;
        file += 1;
      }
    }
    if (file !== FILES) throw new Error(`FEN 第 ${rank + 1} 横线必须有 9 个交点`);
  });
  if (!board.some((piece) => piece === 'K') || !board.some((piece) => piece === 'k')) throw new Error('FEN 必须包含红黑双方将帅');
  return { board, side: activeColor === 'w' ? RED : BLACK };
}

const inside = (file, rank) => file >= 0 && file < FILES && rank >= 0 && rank < RANKS;
const palace = (side, file, rank) => file >= 3 && file <= 5 && (side === RED ? rank >= 7 && rank <= 9 : rank >= 0 && rank <= 2);
const makeMove = (from, to) => ({ from, to });

function pseudoMoves(board, side) {
  const moves = [];
  const add = (from, file, rank) => {
    if (!inside(file, rank)) return false;
    const to = coord(file, rank);
    if (sideOf(board[to]) === side) return false;
    moves.push(makeMove(from, to));
    return true;
  };

  for (let from = 0; from < board.length; from += 1) {
    const piece = board[from];
    if (sideOf(piece) !== side) continue;
    const kind = kindOf(piece);
    const file = fileOf(from);
    const rank = rankOf(from);
    if (kind === 'R' || kind === 'C') {
      for (const [df, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        let x = file + df;
        let y = rank + dr;
        let jumped = false;
        while (inside(x, y)) {
          const to = coord(x, y);
          if (kind === 'R') {
            if (board[to]) {
              if (sideOf(board[to]) !== side) moves.push(makeMove(from, to));
              break;
            }
            moves.push(makeMove(from, to));
          } else if (!jumped) {
            if (board[to]) jumped = true;
            else moves.push(makeMove(from, to));
          } else if (board[to]) {
            if (sideOf(board[to]) !== side) moves.push(makeMove(from, to));
            break;
          }
          x += df;
          y += dr;
        }
      }
    } else if (kind === 'H') {
      for (const [df, dr, lf, lr] of [[1, 2, 0, 1], [-1, 2, 0, 1], [1, -2, 0, -1], [-1, -2, 0, -1], [2, 1, 1, 0], [2, -1, 1, 0], [-2, 1, -1, 0], [-2, -1, -1, 0]]) {
        if (inside(file + lf, rank + lr) && !board[coord(file + lf, rank + lr)]) add(from, file + df, rank + dr);
      }
    } else if (kind === 'E') {
      for (const [df, dr] of [[2, 2], [-2, 2], [2, -2], [-2, -2]]) {
        const eyeFile = file + df / 2;
        const eyeRank = rank + dr / 2;
        const targetRank = rank + dr;
        const notCrossed = side === RED ? targetRank >= 5 : targetRank <= 4;
        if (notCrossed && inside(file + df, targetRank) && !board[coord(eyeFile, eyeRank)]) add(from, file + df, targetRank);
      }
    } else if (kind === 'A') {
      for (const [df, dr] of [[1, 1], [-1, 1], [1, -1], [-1, -1]]) if (palace(side, file + df, rank + dr)) add(from, file + df, rank + dr);
    } else if (kind === 'K') {
      for (const [df, dr] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) if (palace(side, file + df, rank + dr)) add(from, file + df, rank + dr);
      const enemyKing = board.findIndex((item) => kindOf(item) === 'K' && sideOf(item) !== side);
      if (enemyKing >= 0 && fileOf(enemyKing) === file) {
        const step = Math.sign(rankOf(enemyKing) - rank);
        let clear = true;
        for (let y = rank + step; y !== rankOf(enemyKing); y += step) if (board[coord(file, y)]) clear = false;
        if (clear) moves.push(makeMove(from, enemyKing));
      }
    } else if (kind === 'P') {
      const forward = side === RED ? -1 : 1;
      add(from, file, rank + forward);
      const crossed = side === RED ? rank <= 4 : rank >= 5;
      if (crossed) {
        add(from, file - 1, rank);
        add(from, file + 1, rank);
      }
    }
  }
  return moves;
}

export function applyMove(board, move) {
  const next = board.slice();
  next[move.to] = next[move.from];
  next[move.from] = null;
  return next;
}

export function isInCheck(board, side) {
  const king = board.findIndex((piece) => kindOf(piece) === 'K' && sideOf(piece) === side);
  if (king < 0) return true;
  return pseudoMoves(board, otherSide(side)).some((move) => move.to === king);
}

export function legalMoves(board, side) {
  return pseudoMoves(board, side).filter((move) => kindOf(board[move.to]) !== 'K' && !isInCheck(applyMove(board, move), side));
}

export function gameStatus(board, sideToMove) {
  const moves = legalMoves(board, sideToMove);
  if (moves.length) return { over: false, inCheck: isInCheck(board, sideToMove), winner: null, reason: null };
  const checked = isInCheck(board, sideToMove);
  return { over: true, inCheck: checked, winner: otherSide(sideToMove), reason: checked ? '将死' : '困毙' };
}

export const sameMove = (left, right) => left?.from === right?.from && left?.to === right?.to;

export function validateAndReplay(record) {
  if (!record || record.schema !== 'xiangqi-study/v1') throw new Error('棋谱 schema 必须为 xiangqi-study/v1');
  const allowedKeys = ['schema', 'id', 'title', 'category', 'players', 'result', 'source', 'initialPosition', 'moves', 'annotations', 'tags'];
  if (Object.keys(record).some((key) => !allowedKeys.includes(key))) throw new Error('棋谱包含未知字段');
  if (typeof record.id !== 'string' || !record.id.trim()) throw new Error('棋谱缺少 id');
  if (typeof record.title !== 'string' || !record.title.trim()) throw new Error('棋谱缺少标题');
  if (!Array.isArray(record.category) || !record.category.length) throw new Error('棋谱至少需要一个分类');
  if (record.category.some((category) => !['古谱', '现代对局', '开局', '残局'].includes(category))) throw new Error('棋谱分类无效');
  if (!record.players || typeof record.players.red !== 'string' || typeof record.players.black !== 'string') throw new Error('players 必须包含 red 和 black');
  if (!['红胜', '黑胜', '和棋', '未完'].includes(record.result)) throw new Error('棋谱 result 无效');
  if (!record.source || typeof record.source.name !== 'string' || typeof record.source.rights !== 'string' || !record.source.rights.trim()) throw new Error('棋谱缺少来源或 rights 授权说明');
  if (!Array.isArray(record.moves)) throw new Error('moves 必须是数组');
  if (record.initialPosition !== 'standard' && (!record.initialPosition || typeof record.initialPosition.fen !== 'string')) throw new Error('initialPosition 必须是 standard 或包含 FEN 的对象');
  if (record.initialPosition !== 'standard' && Object.keys(record.initialPosition).some((key) => key !== 'fen')) throw new Error('initialPosition 只允许包含 fen 字段');
  if (!Array.isArray(record.tags) || record.tags.some((tag) => typeof tag !== 'string')) throw new Error('tags 必须是字符串数组');
  const startingPosition = record.initialPosition === 'standard' ? { board: initialBoard(), side: RED } : parseFEN(record.initialPosition.fen);
  const board = startingPosition.board.slice();
  let sideToMove = startingPosition.side;
  const positions = [board.slice()];
  const normalizedMoves = [];
  for (let index = 0; index < record.moves.length; index += 1) {
    const item = record.moves[index];
    try {
      if (!item || typeof item.from !== 'string' || typeof item.to !== 'string' || Object.keys(item).some((key) => !['from', 'to'].includes(key))) throw new Error('着法必须只包含 ICCS from/to 坐标');
      const move = { from: fromICCS(item.from), to: fromICCS(item.to) };
      const side = sideToMove;
      if (sideOf(board[move.from]) !== side) throw new Error(`${side === RED ? '红' : '黑'}方起点没有己方棋子`);
      if (!legalMoves(board, side).some((legal) => sameMove(legal, move))) throw new Error('着法不合法');
      normalizedMoves.push({ from: move.from, to: move.to });
      const next = applyMove(board, move);
      board.splice(0, board.length, ...next);
      positions.push(board.slice());
      sideToMove = otherSide(sideToMove);
      if (gameStatus(board, otherSide(side)).over && index < record.moves.length - 1) throw new Error('棋局已经结束，后续仍有着法');
    } catch (error) {
      throw new Error(`第 ${index + 1} 着：${error.message}`);
    }
  }
  const annotations = record.annotations;
  if (typeof annotations !== 'object' || Array.isArray(annotations)) throw new Error('annotations 必须是对象');
  for (const [ply, text] of Object.entries(annotations)) {
    if (!/^\d+$/.test(ply) || Number(ply) < 1 || Number(ply) > normalizedMoves.length) throw new Error(`解说着次无效：${ply}`);
    if (typeof text !== 'string' || [...text].length > 50) throw new Error(`第 ${ply} 着解说必须是 50 字以内文本`);
  }
  return { ...record, moves: normalizedMoves, annotations, positions, initialSide: startingPosition.side };
}

export function positionKey(board, side) {
  return `${board.map((piece) => piece ?? '.').join('')}:${side}`;
}
