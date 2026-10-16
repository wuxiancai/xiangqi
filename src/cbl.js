const HEADER_SIZE = 576;
const RECORD_SIZE = 4096;
const RECORD_MAGIC = 'CCBridge Record';
const OFFSETS = [[128, 101952], [256, 137280], [384, 151080], [512, 207936]];
const PIECES = { 0x11: 'R', 0x12: 'H', 0x13: 'E', 0x14: 'A', 0x15: 'K', 0x16: 'C', 0x17: 'P', 0x21: 'r', 0x22: 'h', 0x23: 'e', 0x24: 'a', 0x25: 'k', 0x26: 'c', 0x27: 'p' };

function readUtf16(bytes) {
  let end = bytes.length;
  if (end % 2) end -= 1;
  for (let index = 0; index + 1 < end; index += 2) if (!bytes[index] && !bytes[index + 1]) { end = index; break; }
  return new TextDecoder('utf-16le').decode(bytes.subarray(0, end)).trim();
}

function boardFen(board) {
  const rows = [];
  for (let rank = 0; rank < 10; rank += 1) {
    let row = '';
    let empty = 0;
    for (let file = 0; file < 9; file += 1) {
      const piece = board[rank * 9 + file];
      if (!piece) empty += 1;
      else { if (empty) row += empty; row += ({ H: 'N', h: 'n', E: 'B', e: 'b' }[piece] ?? piece); empty = 0; }
    }
    if (empty) row += empty;
    rows.push(row);
  }
  return rows.join('/');
}

function recordMoves(record, start) {
  const moves = [];
  let cursor = start;
  if (cursor + 4 > record.length) throw new Error('CBL 开局注释字段不完整');
  const initMarker = new DataView(record.buffer, record.byteOffset + cursor, 4).getInt32(0, true);
  cursor += 4;
  if (initMarker !== 0) {
    if (cursor + 4 > record.length) throw new Error('CBL 开局注释长度字段不完整');
    const initLength = new DataView(record.buffer, record.byteOffset + cursor, 4).getInt32(0, true);
    cursor += 4;
    if (initLength < 0 || initLength > record.length - cursor) throw new Error('CBL 开局注释长度超出记录范围');
    cursor += initLength;
  }
  for (let count = 0; count < 2000 && cursor + 4 <= record.length; count += 1) {
    const mark = record[cursor];
    const from = record[cursor + 2];
    const to = record[cursor + 3];
    cursor += 4;
    if (mark === 0 && from === 0 && to === 0) break;
    let annotationLength = 0;
    if (mark & 4) {
      if (cursor + 4 > record.length) throw new Error('CBL 着法注释长度字段不完整');
      annotationLength = new DataView(record.buffer, record.byteOffset + cursor, 4).getInt32(0, true);
      cursor += 4;
      if (annotationLength < 0 || annotationLength > record.length - cursor) throw new Error('CBL 着法注释长度超出记录范围');
    }
    cursor += annotationLength;
    if (from >= 90 || to >= 90) throw new Error('CBL 着法坐标超出棋盘范围');
    moves.push({ from: `${String.fromCharCode(97 + from % 9)}${Math.floor(from / 9)}`, to: `${String.fromCharCode(97 + to % 9)}${Math.floor(to / 9)}` });
    if (mark & 1) break;
  }
  if (!moves.length) throw new Error('CBL 记录没有主线着法');
  return moves;
}

export function parseCbl(buffer, sourceName = 'import.cbl') {
  const bytes = new Uint8Array(buffer);
  if (bytes.length < HEADER_SIZE || new TextDecoder().decode(bytes.subarray(0, 15)) !== 'CCBridgeLibrary') throw new Error('文件头无效或不是 CCBridge CBL 棋谱库');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const count = view.getInt32(60, true);
  if (count < 0 || count > 100000) throw new Error('CBL 棋谱数量无效');
  const dataOffset = OFFSETS.find(([limit]) => count <= limit)?.[1] ?? 349248;
  const libName = readUtf16(bytes.subarray(64, 576));
  const records = [];
  for (let offset = dataOffset; offset + RECORD_SIZE <= bytes.length; offset += RECORD_SIZE) {
    if (new TextDecoder().decode(bytes.subarray(offset, offset + 15)) !== RECORD_MAGIC) continue;
    const record = bytes.subarray(offset, offset + RECORD_SIZE);
    const title = readUtf16(record.subarray(16, 180)) || `${sourceName.replace(/\.[^.]+$/, '')} 第${records.length + 1}局`;
    const red = readUtf16(record.subarray(756, 1076)) || '红方';
    const black = readUtf16(record.subarray(1140, 1300)) || '黑方';
    const side = record[2112] === 1 ? 'w' : 'b';
    const board = Array(90).fill(null);
    for (let index = 0; index < 90; index += 1) board[Math.floor(index / 9) * 9 + index % 9] = PIECES[record[2120 + index]] ?? null;
    if (!board.includes('K') || !board.includes('k')) continue;
    const moves = recordMoves(record, 2214);
    records.push({ title, players: { red, black }, result: ({ 1: '红胜', 2: '黑胜', 3: '和棋' })[record[2076]] ?? '未完', board, side, moves, initialPosition: { fen: `${boardFen(board)} ${side}` } });
  }
  if (!records.length) throw new Error(`CBL 棋谱库“${libName || sourceName}”中没有可导入的有效记录`);
  return { title: libName || sourceName.replace(/\.[^.]+$/, ''), records };
}

export function cblMovesAsText(record) {
  return `${record.initialPosition.fen}\n${record.moves.map(({ from, to }) => `${from}${to}`).join(' ')}`;
}
