import { BLACK, FILES, fileOf, kindOf, rankOf, sideOf } from './rules.js';

const redNames = { K: '帅', A: '仕', E: '相', R: '车', H: '马', C: '炮', P: '兵' };
const blackNames = { K: '将', A: '士', E: '象', R: '车', H: '马', C: '炮', P: '卒' };
const redDigits = '一二三四五六七八九';
const blackDigits = '123456789';

function distanceLabel(distance, side) {
  return (side === BLACK ? blackDigits : redDigits)[distance - 1];
}

function fileLabel(file, side) {
  const index = side === BLACK ? file : FILES - 1 - file;
  return (side === BLACK ? blackDigits : redDigits)[index];
}

function disambiguator(board, move, piece, side) {
  const file = fileOf(move.from);
  const ranks = board.flatMap((candidate, square) => candidate && sideOf(candidate) === side && kindOf(candidate) === kindOf(piece) && fileOf(square) === file ? [rankOf(square)] : []);
  if (ranks.length < 2) return null;
  ranks.sort((a, b) => side === BLACK ? b - a : a - b);
  const position = ranks.indexOf(rankOf(move.from));
  return ranks.length === 2 ? (position === 0 ? '前' : '后') : ['前', '中', '后'][position] ?? fileLabel(file, side);
}

export function chineseNotation(board, move, side = sideOf(board[move.from])) {
  const piece = board[move.from];
  if (!piece || !side) throw new Error('无法为无效着法生成中文记谱');
  const name = (side === BLACK ? blackNames : redNames)[kindOf(piece)];
  if (!name) throw new Error(`无法识别棋子：${piece}`);
  const fromFile = fileOf(move.from);
  const toFile = fileOf(move.to);
  const fromRank = rankOf(move.from);
  const toRank = rankOf(move.to);
  const direction = toRank === fromRank ? '平' : (side === BLACK ? toRank > fromRank : toRank < fromRank) ? '进' : '退';
  const amount = fromFile === toFile ? distanceLabel(Math.abs(toRank - fromRank), side) : fileLabel(toFile, side);
  const prefix = disambiguator(board, move, piece, side);
  return `${prefix ?? name}${prefix ? '' : fileLabel(fromFile, side)}${prefix ? name : ''}${direction}${amount}`;
}
