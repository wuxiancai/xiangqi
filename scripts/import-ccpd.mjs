import { mkdir, writeFile } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyMove, initialBoard, kindOf, legalMoves, otherSide, parseFEN, RED, sideOf, toICCS, validateAndReplay } from '../src/rules.js';

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const revision = '368a47a947773dd8692c026e286dd19b6277b993';
const apiRoot = `https://api.github.com/repos/Yvonne761/Chinese-Chess-Practical-Dataset/contents`;
const rawRoot = `https://raw.githubusercontent.com/Yvonne761/Chinese-Chess-Practical-Dataset/${revision}`;
const masters = ['呂欽', '胡榮華', '許銀川', '趙國榮', '楊官璘', '李來群'];
const outputPath = join(projectRoot, 'data/records/modern-games.json');
const pieceKinds = { 車: 'R', 车: 'R', 馬: 'H', 马: 'H', 相: 'E', 象: 'E', 仕: 'A', 士: 'A', 帥: 'K', 帅: 'K', 將: 'K', 将: 'K', 炮: 'C', 砲: 'C', 包: 'C', 兵: 'P', 卒: 'P' };
const digitValues = { 一: 1, 二: 2, 三: 3, 四: 4, 五: 5, 六: 6, 七: 7, 八: 8, 九: 9 };
const numberOf = (value) => digitValues[value] ?? Number(value);
const notationFile = (number, side) => side === RED ? 9 - number : number - 1;
const execFileAsync = promisify(execFile);

async function download(url) {
  const { stdout } = await execFileAsync('curl', ['-fsSL', '--retry', '3', '--retry-all-errors', '--max-time', '30', '-A', 'chuhe-xiangqi-v1-data-curation', url], { encoding: 'buffer', maxBuffer: 8 * 1024 * 1024 });
  return stdout;
}

async function getJson(url) {
  return JSON.parse((await download(url)).toString('utf8'));
}

async function getBig5Text(url) {
  return new TextDecoder('big5').decode(await download(url));
}

function parseHeaders(text) {
  return Object.fromEntries([...text.matchAll(/^\[([^\s]+) "(.*)"\]$/gm)].map((match) => [match[1], match[2]]));
}

function parseTokens(text) {
  const score = text.replace(/^\[[^\n]*\]\s*$/gm, ' ').replace(/\{[^}]*\}/g, ' ').replace(/;[^\n]*/g, ' ').replace(/\([^)]*\)/g, ' ').replace(/\d+\.(?:\.\.)?/g, ' ');
  return score.split(/\s+/).filter((token) => token && !['1-0', '0-1', '1/2-1/2', '*'].includes(token));
}

function resolveNotation(board, side, rawToken) {
  const token = rawToken.normalize('NFKC').replace(/[?!+#。！？，]/g, '');
  const match = token.match(/^([車车馬马相象仕士帥帅將将炮砲包兵卒])([前中后后前一二三四五六七八九1-9])([进進退平])([一二三四五六七八九1-9])$/);
  if (!match) return null;
  const [, pieceName, sourceMark, rawAction, rawTarget] = match;
  const action = rawAction === '進' ? '进' : rawAction;
  const kind = pieceKinds[pieceName];
  const sourceFile = /^[1-9]$/.test(sourceMark) || digitValues[sourceMark] ? notationFile(numberOf(sourceMark), side) : null;
  let candidates = legalMoves(board, side).filter((move) => sideOf(board[move.from]) === side && kindOf(board[move.from]) === kind);
  if (sourceFile !== null) candidates = candidates.filter((move) => move.from % 9 === sourceFile);
  else {
    const sourcesByFile = new Map();
    for (const candidate of candidates) sourcesByFile.set(candidate.from % 9, [...new Set([...(sourcesByFile.get(candidate.from % 9) ?? []), candidate.from])]);
    const ambiguousSquares = [...sourcesByFile.values()].filter((squares) => squares.length > 1).flat();
    if (!ambiguousSquares.length) return null;
    const sourceSquares = [...new Set(ambiguousSquares)];
    candidates = candidates.filter((candidate) => sourceSquares.includes(candidate.from));
    const frontRank = side === RED ? Math.min : Math.max;
    const backRank = side === RED ? Math.max : Math.min;
    const rank = (square) => Math.floor(square / 9);
    if (sourceMark === '前') candidates = candidates.filter((move) => rank(move.from) === frontRank(...sourceSquares.map(rank)));
    else if (sourceMark === '后') candidates = candidates.filter((move) => rank(move.from) === backRank(...sourceSquares.map(rank)));
    else if (sourceMark === '中') {
      const ranks = [...new Set(sourceSquares.map(rank))].sort((a, b) => side === RED ? a - b : b - a);
      if (ranks.length < 3) return null;
      candidates = candidates.filter((move) => rank(move.from) === ranks[1]);
    }
  }
  const target = numberOf(rawTarget);
  if (action === '平') {
    const targetFile = notationFile(target, side);
    candidates = candidates.filter((move) => move.to % 9 === targetFile && Math.floor(move.to / 9) === Math.floor(move.from / 9));
  } else if (kind === 'H' || kind === 'E' || kind === 'A') {
    const targetFile = notationFile(target, side);
    const forwardSign = side === RED ? -1 : 1;
    candidates = candidates.filter((move) => move.to % 9 === targetFile && Math.sign(Math.floor(move.to / 9) - Math.floor(move.from / 9)) === forwardSign * (action === '进' ? 1 : -1));
  } else {
    const forwardSign = side === RED ? -1 : 1;
    const distance = action === '进' ? forwardSign * target : -forwardSign * target;
    candidates = candidates.filter((move) => move.to % 9 === move.from % 9 && Math.floor(move.to / 9) - Math.floor(move.from / 9) === distance);
  }
  return candidates.length === 1 ? candidates[0] : null;
}

function convertGame(text, file, master, collection = 'master') {
  const headers = parseHeaders(text);
  const tokens = parseTokens(text);
  if (!tokens.length) return null;
  let start;
  try { start = headers.FEN ? parseFEN(headers.FEN) : { board: initialBoard(), side: RED }; } catch { return null; }
  let board = start.board.slice();
  let sideToMove = start.side;
  const moves = [];
  for (let index = 0; index < tokens.length; index += 1) {
    const move = resolveNotation(board, sideToMove, tokens[index]);
    if (!move) return null;
    moves.push({ from: toICCS(move.from), to: toICCS(move.to) });
    board = applyMove(board, move);
    sideToMove = otherSide(sideToMove);
  }
  const result = { '1-0': '红胜', '0-1': '黑胜', '1/2-1/2': '和棋' }[headers.Result] ?? '未完';
  const red = headers.Red || master;
  const black = headers.Black || '未知对手';
  const record = {
    schema: 'xiangqi-study/v1',
    id: `ccpd-${collection}-${master}-${file.replace(/[^0-9]/g, '')}`,
    title: `${red} vs ${black}${headers.Event ? ` · ${headers.Event}` : ''}`,
    category: [collection === 'endgame' ? '残局' : '现代对局'],
    players: { red, black },
    result,
    source: {
      name: 'Chinese Chess Practical Dataset (CCPD)',
      url: collection === 'endgame'
        ? `https://github.com/Yvonne761/Chinese-Chess-Practical-Dataset/blob/${revision}/Dataset/殘局/${file}`
        : `https://github.com/Yvonne761/Chinese-Chess-Practical-Dataset/blob/${revision}/Dataset/對局/大師對局/以棋手分類/${master}/${file}`,
      rights: 'CC BY 4.0；原始棋谱由 Big5 PGN 转为 xiangqi-study/v1 ICCS 着法。见 data/ATTRIBUTION.md',
    },
    initialPosition: headers.FEN ? { fen: headers.FEN } : 'standard',
    moves,
    annotations: {},
    tags: collection === 'endgame' ? ['CCPD 残局样本'] : [master, headers.ECCO ? `ECCO ${headers.ECCO}` : '大师对局'],
  };
  try { validateAndReplay(record); } catch { return null; }
  return record;
}

const records = [];
const uniqueLines = new Set();
for (const master of masters) {
  const path = ['Dataset', '對局', '大師對局', '以棋手分類', master].map(encodeURIComponent).join('/');
  const listing = await getJson(`${apiRoot}/${path}?ref=${revision}`);
  const files = listing.filter((item) => item.type === 'file' && item.name.endsWith('.pgn')).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 20);
  const downloaded = await Promise.all(files.map(async (item) => ({ name: item.name, text: await getBig5Text(item.download_url) })));
  let accepted = 0;
  for (const item of downloaded) {
    const record = convertGame(item.text, item.name, master);
    if (!record) continue;
    const lineKey = record.moves.map((move) => `${move.from}${move.to}`).join('');
    if (uniqueLines.has(lineKey)) continue;
    uniqueLines.add(lineKey); records.push(record); accepted += 1;
    if (accepted >= 6) break;
  }
}

const endgameListing = await getJson(`${apiRoot}/${encodeURIComponent('Dataset')}/${encodeURIComponent('殘局')}?ref=${revision}`);
const endgameFiles = endgameListing.filter((item) => item.type === 'file' && item.name.endsWith('.pgn')).sort((a, b) => a.name.localeCompare(b.name)).slice(0, 120);
const endgames = await Promise.all(endgameFiles.map(async (item) => ({ name: item.name, text: await getBig5Text(item.download_url) })));
let acceptedEndgames = 0;
for (const item of endgames) {
  const record = convertGame(item.text, item.name, 'CCPD残局', 'endgame');
  if (!record) continue;
  const lineKey = `${record.initialPosition.fen}:${record.moves.map((move) => `${move.from}${move.to}`).join('')}`;
  if (uniqueLines.has(lineKey)) continue;
  uniqueLines.add(lineKey); records.push(record); acceptedEndgames += 1;
  if (acceptedEndgames >= 40) break;
}

await mkdir(dirname(outputPath), { recursive: true });
await writeFile(outputPath, `${JSON.stringify(records, null, 2)}\n`);
console.log(`Wrote ${records.length} games (${records.length - acceptedEndgames} modern, ${acceptedEndgames} endgame) to ${outputPath}`);
