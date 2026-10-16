import { initialBoard } from './rules.js';

const HEADER_SIZE = 1024;
const MAX_MOVES = 2000;
const XQF_PIECES = ['R', 'H', 'E', 'A', 'K', 'A', 'E', 'H', 'R', 'C', 'C', 'P', 'P', 'P', 'P', 'P', 'r', 'h', 'e', 'a', 'k', 'a', 'e', 'h', 'r', 'c', 'c', 'p', 'p', 'p', 'p', 'p'];
const ENCRYPTION_MASK = '[(C) Copyright Mr. Dong Shiwei.]';

function readString(bytes, offset, capacity) {
  const length = Math.min(bytes[offset] ?? 0, capacity - 1);
  if (!length) return '';
  const value = bytes.subarray(offset + 1, offset + 1 + length);
  for (const encoding of ['utf-8', 'gbk']) {
    try {
      const decoded = new TextDecoder(encoding, { fatal: true }).decode(value).trim();
      if (decoded) return decoded;
    } catch {}
  }
  return '';
}

function buildKeyStream(header, version) {
  if (version < 11) return { stream: Array(32).fill(0), pieceOffset: 0, sourceOffset: 0, destinationOffset: 0, commentOffset: 0 };
  const square54Plus221 = (value) => value * value * 54 + 221;
  const pieceOffset = (square54Plus221(header[13]) * header[13]) & 0xff;
  const sourceOffset = (square54Plus221(header[14]) * pieceOffset) & 0xff;
  const destinationOffset = (square54Plus221(header[15]) * sourceOffset) & 0xff;
  const commentOffset = ((header[12] * 256 + header[13]) % 32000) + 767;
  const key = Array.from({ length: 4 }, (_, index) => header[8 + index] | (header[12 + index] & header[3]));
  const stream = Array.from({ length: 32 }, (_, index) => key[index % 4] & ENCRYPTION_MASK.charCodeAt(index));
  return { stream, pieceOffset, sourceOffset, destinationOffset, commentOffset };
}

function decodeText(bytes) {
  for (const encoding of ['utf-8', 'gbk']) {
    try { return new TextDecoder(encoding, { fatal: true }).decode(bytes); } catch {}
  }
  return '';
}

export function parseXqf(buffer, sourceName = 'import.xqf') {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < HEADER_SIZE + 8 || bytes[0] !== 0x58 || bytes[1] !== 0x51) throw new Error('文件头无效或不是有效的 XQF 棋谱');
  const version = bytes[2];
  if (version < 10 || version > 18) throw new Error(`暂不支持 XQF ${version / 10} 版本`);
  const { stream, pieceOffset, sourceOffset, destinationOffset, commentOffset } = buildKeyStream(bytes.subarray(0, 16), version);
  const title = readString(bytes, 0x50, 64) || sourceName.replace(/\.[^.]+$/, '');
  const redPlayer = readString(bytes, 0x130, 16) || '红方';
  const blackPlayer = readString(bytes, 0x140, 16) || '黑方';
  const setupType = bytes[0x40];
  let board;
  if (setupType < 2) {
    board = initialBoard();
  } else {
    board = Array(90).fill(null);
    for (let index = 0; index < 32; index += 1) {
      const pieceIndex = version >= 12 ? (pieceOffset + 1 + index) % 32 : index;
      const square = (bytes[16 + index] - pieceOffset) & 0xff;
      if (square < 90) {
        const file = Math.floor(square / 10);
        const rank = 9 - (square % 10);
        const position = rank * 9 + file;
        if (board[position]) throw new Error('XQF 初始局面包含重叠棋子');
        board[position] = XQF_PIECES[pieceIndex];
      }
    }
    if (!board.includes('K') || !board.includes('k')) throw new Error('XQF 自定义局面缺少帅/将');
  }

  let cursor = HEADER_SIZE;
  let streamIndex = 0;
  let firstRecord = true;
  let ended = false;
  const moves = [];
  while (!ended && cursor + 4 <= bytes.length && moves.length <= MAX_MOVES) {
    const record = Array.from(bytes.subarray(cursor, cursor + 4));
    cursor += 4;
    if (version >= 11) {
      for (let index = 0; index < record.length; index += 1) {
        record[index] = (record[index] - stream[streamIndex] + 256) & 0xff;
        streamIndex = (streamIndex + 1) % 32;
      }
    }
    let commentLength = 0;
    if (version >= 11) {
      if (record[2] & 0x20) {
        if (cursor + 4 > bytes.length) throw new Error('XQF 注释长度字段不完整');
        const encodedLength = Array.from(bytes.subarray(cursor, cursor + 4));
        cursor += 4;
        for (let index = 0; index < encodedLength.length; index += 1) {
          encodedLength[index] = (encodedLength[index] - stream[streamIndex] + 256) & 0xff;
          streamIndex = (streamIndex + 1) % 32;
        }
        commentLength = ((encodedLength[0] | (encodedLength[1] << 8) | (encodedLength[2] << 16) | (encodedLength[3] << 24)) - commentOffset) >>> 0;
      }
      ended = (record[2] & 0x80) === 0;
    } else {
      if (cursor + 4 > bytes.length) throw new Error('XQF 注释长度字段不完整');
      commentLength = (bytes[cursor] | (bytes[cursor + 1] << 8) | (bytes[cursor + 2] << 16) | (bytes[cursor + 3] << 24)) >>> 0;
      cursor += 4;
      ended = (record[2] & 0xf0) === 0;
    }
    if (commentLength > 1024 * 1024) throw new Error('XQF 单步注释超过 1 MiB，已拒绝导入');
    if (commentLength > bytes.length - cursor) throw new Error('XQF 注释长度超出文件范围');
    const commentBytes = bytes.subarray(cursor, cursor + commentLength);
    if (version >= 11) {
      for (let index = 0; index < commentBytes.length; index += 1) {
        commentBytes[index] = (commentBytes[index] - stream[streamIndex] + 256) & 0xff;
        streamIndex = (streamIndex + 1) % 32;
      }
    }
    cursor += commentLength;
    if (firstRecord) { firstRecord = false; continue; }
    const fromSquare = (record[0] - 24 - sourceOffset) & 0xff;
    const toSquare = (record[1] - 32 - destinationOffset) & 0xff;
    if (fromSquare >= 90 || toSquare >= 90) throw new Error('XQF 中存在超出棋盘范围的着法坐标');
    const from = `${String.fromCharCode(97 + Math.floor(fromSquare / 10))}${9 - (fromSquare % 10)}`;
    const to = `${String.fromCharCode(97 + Math.floor(toSquare / 10))}${9 - (toSquare % 10)}`;
    moves.push({ from, to, comment: decodeText(commentBytes).trim() });
    if (ended) break;
  }
  if (!ended && moves.length <= MAX_MOVES) throw new Error('XQF 棋谱记录不完整或缺少结束标记');
  if (moves.length > MAX_MOVES) throw new Error(`XQF 着法超过 ${MAX_MOVES} 手上限`);
  if (!moves.length) throw new Error('XQF 文件没有棋谱着法');
  const resultByte = bytes[0x33];
  const result = resultByte === 1 ? '红胜' : resultByte === 2 ? '黑胜' : resultByte === 3 ? '和棋' : '未完';
  return { title, players: { red: redPlayer, black: blackPlayer }, result, moves, board, initialPosition: setupType < 2 ? 'standard' : { board } };
}

export function xqfMovesAsText(parsed) {
  const rows = [];
  for (let rank = 0; rank <= 9; rank += 1) {
    let row = '';
    let empty = 0;
    for (let file = 0; file < 9; file += 1) {
      const piece = parsed.board[rank * 9 + file];
      if (piece === undefined) throw new Error('XQF 初始局面数据不完整');
      if (!piece) empty += 1;
      else { if (empty) row += empty; row += ({ H: 'N', h: 'n', E: 'B', e: 'b' }[piece] ?? piece); empty = 0; }
    }
    if (empty) row += empty;
    rows.push(row);
  }
  const firstMovePiece = parsed.board?.[(Number(parsed.moves[0]?.from[1]) * 9) + parsed.moves[0]?.from.charCodeAt(0) - 97];
  const side = firstMovePiece && firstMovePiece === firstMovePiece.toUpperCase() ? 'w' : 'b';
  const fen = `${rows.join('/')} ${side}`;
  return `${fen}\n${parsed.moves.map(({ from, to }) => `${from}${to}`).join(' ')}`;
}
