import { applyMove, fromICCS, isInCheck, legalMoves, otherSide, sideOf, kindOf, positionKey, toICCS } from './rules.js';

const pieceValues = { K: 20000, R: 900, C: 460, H: 430, A: 210, E: 210, P: 100 };
const searchLimits = {
  beginner: { depth: 1, nodes: 5000, timeMs: 1000 },
  club: { depth: 3, nodes: 18000, timeMs: 4000 },
  advanced: { depth: 4, nodes: 45000, timeMs: 7000 },
  max: { depth: 6, nodes: 200000, timeMs: 15000 },
};
const mateScore = 50000;
const searchLimitReached = Symbol('search limit reached');

export function chooseLocalMoveAsync(board, side, strength = 'max', signal) {
  if (typeof Worker === 'undefined') return Promise.resolve(chooseLocalMove(board, side, strength));
  return new Promise((resolve, reject) => {
    const worker = new Worker(new URL('./ai-worker.js', import.meta.url), { type: 'module' });
    const finish = () => worker.terminate();
    worker.onmessage = ({ data }) => { finish(); data.error ? reject(new Error(data.error)) : resolve(data.move); };
    worker.onerror = (event) => { finish(); reject(new Error(event.message || '本地 AI 搜索失败')); };
    signal?.addEventListener('abort', () => { finish(); reject(new DOMException('请求已取消', 'AbortError')); }, { once: true });
    worker.postMessage({ board, side, strength });
  });
}

function evaluate(board, perspective) {
  let score = 0;
  for (let square = 0; square < board.length; square += 1) {
    const piece = board[square];
    if (!piece) continue;
    const side = sideOf(piece);
    const sign = side === perspective ? 1 : -1;
    const kind = kindOf(piece);
    const file = square % 9;
    const rank = Math.floor(square / 9);
    let positional = 0;
    if (kind === 'P') {
      const advance = side === 'red' ? 6 - rank : rank - 3;
      positional += Math.max(0, advance) * 11;
      if (side === 'red' ? rank <= 4 : rank >= 5) positional += 24;
      positional += Math.max(0, 3 - Math.abs(4 - file)) * 3;
    } else if (kind === 'H') {
      positional += Math.max(0, 5 - Math.max(Math.abs(4 - file), Math.abs(4.5 - rank))) * 7;
    } else if (kind === 'R' || kind === 'C') {
      positional += Math.max(0, 4 - Math.abs(4 - file)) * 2;
    }
    score += sign * (pieceValues[kind] + positional);
  }
  if (isInCheck(board, otherSide(perspective))) score += 18;
  if (isInCheck(board, perspective)) score -= 18;
  return Math.round(score);
}

function sameMove(left, right) { return left?.from === right?.from && left?.to === right?.to; }

function orderMoves(board, moves, preferredMove = null, context = null, ply = 0, side = null) {
  return moves.sort((left, right) => {
    const leftPreferred = sameMove(preferredMove, left);
    const rightPreferred = sameMove(preferredMove, right);
    if (leftPreferred !== rightPreferred) return Number(rightPreferred) - Number(leftPreferred);
    const leftVictim = board[left.to];
    const rightVictim = board[right.to];
    const leftScore = leftVictim ? 10000 + pieceValues[kindOf(leftVictim)] * 10 - pieceValues[kindOf(board[left.from])] : 0;
    const rightScore = rightVictim ? 10000 + pieceValues[kindOf(rightVictim)] * 10 - pieceValues[kindOf(board[right.from])] : 0;
    if (leftScore !== rightScore) return rightScore - leftScore;
    const killers = context?.killers.get(ply) ?? [];
    const leftKiller = killers.findIndex((move) => sameMove(move, left));
    const rightKiller = killers.findIndex((move) => sameMove(move, right));
    if (leftKiller !== rightKiller) return leftKiller - rightKiller;
    const leftHistory = context?.history.get(`${side}:${left.from}:${left.to}`) ?? 0;
    const rightHistory = context?.history.get(`${side}:${right.from}:${right.to}`) ?? 0;
    return rightHistory - leftHistory;
  });
}

function quiescence(board, side, alpha, beta, ply, remaining, context) {
  if (Date.now() >= context.deadline) throw searchLimitReached;
  if (++context.nodes > context.nodeLimit) throw searchLimitReached;
  const inCheck = isInCheck(board, side);
  const moves = legalMoves(board, side);
  if (!moves.length) return -mateScore + ply;
  if (remaining <= 0) return evaluate(board, side);
  let best = inCheck ? -Infinity : evaluate(board, side);
  if (!inCheck) {
    if (best >= beta) return best;
    alpha = Math.max(alpha, best);
  }
  const tacticalMoves = inCheck ? moves : moves.filter((move) => board[move.to]);
  for (const move of orderMoves(board, tacticalMoves, null, context, ply, side)) {
    const score = -quiescence(applyMove(board, move), otherSide(side), -beta, -alpha, ply + 1, remaining - 1, context);
    best = Math.max(best, score);
    alpha = Math.max(alpha, score);
    if (alpha >= beta) break;
  }
  return best;
}

function search(board, side, depth, alpha, beta, ply, context) {
  if (Date.now() >= context.deadline) throw searchLimitReached;
  if (++context.nodes > context.nodeLimit) throw searchLimitReached;
  const originalAlpha = alpha;
  const originalBeta = beta;
  const key = positionKey(board, side);
  const cached = context.table.get(key);
  if (cached?.depth >= depth) {
    if (cached.bound === 'exact') return cached.score;
    if (cached.bound === 'lower') alpha = Math.max(alpha, cached.score);
    else beta = Math.min(beta, cached.score);
    if (alpha >= beta) return cached.score;
  }
  if (depth <= 0) return quiescence(board, side, alpha, beta, ply, 5, context);
  const moves = legalMoves(board, side);
  if (!moves.length) return -mateScore + ply;
  const ordered = orderMoves(board, moves, cached?.move, context, ply, side);
  let best = -Infinity;
  let bestMove = ordered[0];
  let moveIndex = 0;
  for (const move of ordered) {
    const next = applyMove(board, move);
    let score;
    const lateQuietMove = moveIndex >= 4 && depth >= 3 && !board[move.to];
    if (lateQuietMove) {
      score = -search(next, otherSide(side), depth - 2, -alpha - 1, -alpha, ply + 1, context);
      if (score > alpha) score = -search(next, otherSide(side), depth - 1, -beta, -alpha, ply + 1, context);
    } else if (moveIndex === 0) score = -search(next, otherSide(side), depth - 1, -beta, -alpha, ply + 1, context);
    else {
      score = -search(next, otherSide(side), depth - 1, -alpha - 1, -alpha, ply + 1, context);
      if (score > alpha && score < beta) score = -search(next, otherSide(side), depth - 1, -beta, -alpha, ply + 1, context);
    }
    moveIndex += 1;
    if (score > best) { best = score; bestMove = move; }
    alpha = Math.max(alpha, best);
    if (beta <= alpha) {
      if (!board[move.to]) {
        const killers = context.killers.get(ply) ?? [];
        if (!killers.some((candidate) => sameMove(candidate, move))) context.killers.set(ply, [move, ...killers].slice(0, 2));
        const historyKey = `${side}:${move.from}:${move.to}`;
        context.history.set(historyKey, Math.min(100000, (context.history.get(historyKey) ?? 0) + depth * depth));
      }
      break;
    }
  }
  const bound = best <= originalAlpha ? 'upper' : best >= originalBeta ? 'lower' : 'exact';
  context.table.set(key, { depth, score: best, move: bestMove, bound });
  return best;
}

export function chooseLocalMove(board, side, strength = 'max', stats = null) {
  const moves = legalMoves(board, side);
  if (!moves.length) { if (stats) Object.assign(stats, { depth: 0, nodes: 0 }); return null; }
  const limits = searchLimits[strength] ?? searchLimits.max;
  const context = { nodes: 0, nodeLimit: limits.nodes, deadline: Date.now() + limits.timeMs, table: new Map(), killers: new Map(), history: new Map() };
  let selected = orderMoves(board, moves)[0];
  let completedDepth = 0;
  for (let depth = 1; depth <= limits.depth; depth += 1) {
    let iterationBest = selected;
    let bestScore = -Infinity;
    let alpha = -Infinity;
    try {
      const ordered = orderMoves(board, moves, selected, context, 0, side);
      let firstMove = true;
      for (const move of ordered) {
        const next = applyMove(board, move);
        let score;
        if (firstMove) score = -search(next, otherSide(side), depth - 1, -Infinity, -alpha, 1, context);
        else {
          score = -search(next, otherSide(side), depth - 1, -alpha - 1, -alpha, 1, context);
          if (score > alpha) score = -search(next, otherSide(side), depth - 1, -Infinity, -alpha, 1, context);
        }
        firstMove = false;
        if (score > bestScore) { bestScore = score; iterationBest = move; }
        alpha = Math.max(alpha, bestScore);
      }
      selected = iterationBest;
      completedDepth = depth;
    } catch (error) {
      if (error !== searchLimitReached) throw error;
      break;
    }
  }
  if (stats) Object.assign(stats, { depth: completedDepth, nodes: context.nodes });
  return selected;
}

export async function requestSuggestion({ board, side, moves, settings, strength, signal }) {
  if (!settings.apiUrl || !settings.apiKey || !settings.model) {
    return { move: await chooseLocalMoveAsync(board, side, strength, signal), explanation: '本地搜索建议，棋力未经对局基准认证。', provider: 'local' };
  }
  const legal = moves.map((move) => ({ from: toICCS(move.from), to: toICCS(move.to) }));
  const response = await fetch(`${settings.apiUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${settings.apiKey}` },
    signal,
    body: JSON.stringify({
      model: settings.model,
      temperature: 0.2,
      response_format: { type: 'json_object' },
      messages: [
        { role: 'system', content: '你是中国象棋局势分析助手。只从合法着法数组中选一个建议。只返回 JSON：{"from":"e6","to":"e5","explanation":"不超过50字"}，from/to 必须原样取自合法着法。不要声称棋力等级。' },
        { role: 'user', content: JSON.stringify({ board, side, legalMoves: legal }) },
      ],
    }),
  });
  if (!response.ok) throw new Error(`AI 服务返回 HTTP ${response.status}`);
  const data = await response.json();
  const content = data.choices?.[0]?.message?.content;
  let result;
  try { result = JSON.parse(content); } catch { throw new Error('AI 返回内容不是有效 JSON'); }
  let move;
  try { move = { from: fromICCS(result.from), to: fromICCS(result.to) }; } catch { throw new Error('AI 返回了无效坐标，已忽略'); }
  if (!moves.some((candidate) => candidate.from === move.from && candidate.to === move.to)) throw new Error('AI 返回了不合法着法，已忽略');
  if (typeof result.explanation !== 'string') throw new Error('AI 缺少局势说明');
  return { move, explanation: [...result.explanation].slice(0, 50).join(''), provider: 'external' };
}

export function gamePositionKey(board, side) { return positionKey(board, side); }
