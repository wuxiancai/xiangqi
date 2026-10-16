import { applyMove, fromICCS, isInCheck, legalMoves, otherSide, sideOf, kindOf, positionKey, toICCS } from './rules.js';

const pieceValues = { K: 10000, R: 900, C: 450, H: 400, A: 200, E: 200, P: 100 };
const depthByStrength = { beginner: 1, club: 2, advanced: 3, max: 4 };

export function chooseLocalMoveAsync(board, side, strength = 'beginner', signal) {
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
  for (const piece of board) if (piece) score += (sideOf(piece) === perspective ? 1 : -1) * pieceValues[kindOf(piece)];
  if (isInCheck(board, otherSide(perspective))) score += 8;
  return score;
}

function search(board, side, depth, alpha, beta, perspective) {
  const moves = legalMoves(board, side);
  if (!moves.length) return side !== perspective ? 50000 + depth : -50000 - depth;
  if (depth === 0) return evaluate(board, perspective);
  moves.sort((a, b) => Number(Boolean(board[b.to])) - Number(Boolean(board[a.to])));
  const maximizing = side === perspective;
  let best = maximizing ? -Infinity : Infinity;
  for (const move of moves) {
    const score = search(applyMove(board, move), otherSide(side), depth - 1, alpha, beta, perspective);
    if (maximizing) { best = Math.max(best, score); alpha = Math.max(alpha, best); }
    else { best = Math.min(best, score); beta = Math.min(beta, best); }
    if (beta <= alpha) break;
  }
  return best;
}

export function chooseLocalMove(board, side, strength = 'beginner') {
  const depth = depthByStrength[strength] ?? 1;
  const moves = legalMoves(board, side);
  if (!moves.length) return null;
  let selected = moves[0];
  let best = -Infinity;
  let alpha = -Infinity;
  for (const move of moves) {
    const next = applyMove(board, move);
    const score = search(next, otherSide(side), depth - 1, alpha, Infinity, side);
    if (score > best) { best = score; selected = move; alpha = score; }
  }
  return selected;
}

export async function requestSuggestion({ board, side, moves, settings, strength, signal }) {
  if (!settings.apiUrl || !settings.apiKey || !settings.model) {
    return { move: await chooseLocalMoveAsync(board, side, strength, signal), explanation: '本地基础搜索建议，棋力未认证。', provider: 'local' };
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
