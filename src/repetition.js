import { applyMove, kindOf, legalMoves, otherSide, rankOf, sideOf } from './rules.js';

const pieceOrder = { K: 0, A: 1, E: 1, P: 1, C: 4, H: 4, R: 6 };

// A direct, profitable legal capture threat is a chase candidate. The official
// 2020 rules contain further special cases; these checks cover rooted pieces,
// reciprocal exchanges, the king/pawn exception, and the explicit strong-piece
// exceptions in rule 26.5.
export function chasedTargets(board, side, ids) {
  const targets = new Set();
  for (const move of legalMoves(board, side)) {
    const attacker = board[move.from];
    const victim = board[move.to];
    if (!victim || sideOf(victim) === side) continue;
    const attackerKind = kindOf(attacker);
    const victimKind = kindOf(victim);
    if (attackerKind === 'K' || attackerKind === 'P' || victimKind === 'K') continue;
    if (victimKind === 'P') {
      const crossed = sideOf(victim) === 'red' ? rankOf(move.to) <= 4 : rankOf(move.to) >= 5;
      if (!crossed) continue;
    }

    const afterCapture = applyMove(board, move);
    const recapturable = legalMoves(afterCapture, otherSide(side)).some((reply) => reply.to === move.to);
    const exemptExchange = (['H', 'C'].includes(attackerKind) && victimKind === 'R')
      || (['A', 'E'].includes(attackerKind) && ['R', 'C', 'H'].includes(victimKind));
    if (recapturable && !exemptExchange && pieceOrder[attackerKind] >= pieceOrder[victimKind]) continue;
    targets.add(ids[move.to]);
  }
  return targets;
}

function classifyCycle(entries) {
  const result = {};
  for (const side of ['red', 'black']) {
    const moves = entries.filter((entry) => entry.mover === side);
    if (!moves.length) { result[side] = { level: 0, kind: 'allowed' }; continue; }
    const chaseMoves = moves.filter((entry) => !entry.gaveCheck);
    if (!chaseMoves.length) {
      result[side] = { level: 2, kind: 'long-check' };
      continue;
    }
    const chaseSet = (entry) => new Set(entry.chased ??= entry.board && entry.ids
      ? [...chasedTargets(entry.board, side, entry.ids)]
      : []);
    let common = chaseSet(chaseMoves[0]);
    for (const entry of chaseMoves.slice(1)) {
      const targets = chaseSet(entry);
      common = new Set([...common].filter((target) => targets.has(target)));
    }
    if (common.size) result[side] = { level: moves.some((entry) => entry.gaveCheck) ? 2 : 1, kind: moves.some((entry) => entry.gaveCheck) ? 'check-chase' : 'long-chase' };
    else result[side] = { level: 0, kind: 'allowed' };
  }
  return result;
}

function sameMoves(left, right) {
  return left.length > 0 && left.length === right.length
    && left.every((entry, index) => entry.moveKey === right[index].moveKey);
}

function resultFor(levels) {
  const red = levels.red.level;
  const black = levels.black.level;
  if (red === black) return { over: true, winner: null, reason: '三次循环，双方不变作和' };
  const loser = red > black ? 'red' : 'black';
  const violation = levels[loser].kind;
  const reason = violation === 'long-check' ? '长将判负'
    : `${loser === 'red' ? '红方' : '黑方'}${violation === 'check-chase' ? '一将一捉' : '长捉'}判负`;
  return {
    over: true,
    loser,
    winner: loser === 'red' ? 'black' : 'red',
    reason,
  };
}

export function adjudicateRepetition(positionTrace, { includePending = false } = {}) {
  const occurrences = new Map();
  positionTrace.forEach(({ key }, index) => {
    const indices = occurrences.get(key) ?? [];
    indices.push(index);
    occurrences.set(key, indices);
  });

  for (const indices of occurrences.values()) {
    if (indices.length < 4) continue;

    // Traditional Chinese Association rules require three complete cycles.
    // Use the first four matching positions and ensure the three move loops match.
    for (let start = 0; start <= indices.length - 4; start += 1) {
      const [first, second, third, trigger] = indices.slice(start, start + 4);
      const firstLoop = positionTrace.slice(first + 1, second + 1);
      const secondLoop = positionTrace.slice(second + 1, third + 1);
      const thirdLoop = positionTrace.slice(third + 1, trigger + 1);
      if (!sameMoves(firstLoop, secondLoop) || !sameMoves(secondLoop, thirdLoop)) continue;

      const cycleEntries = positionTrace.slice(first + 1, trigger + 1);
      const levels = classifyCycle(cycleEntries);
      const checks = ['red', 'black'].filter((side) => levels[side].kind === 'long-check');
      if (checks.length === 1 && levels[checks[0] === 'red' ? 'black' : 'red'].level === 0) {
        return resultFor(levels);
      }
      if (!includePending) continue;

      const expectedTail = positionTrace.slice(trigger + 1, trigger + 5);
      if (expectedTail.length < 4) {
        const side = levels.red.level === levels.black.level ? null : (levels.red.level > levels.black.level ? 'red' : 'black');
        const label = side ? `${side === 'red' ? '红方' : '黑方'}疑似${({ 'long-check': '长将', 'long-chase': '长捉', 'check-chase': '一将一捉' })[levels[side].kind]}` : '双方重复着法';
        return { over: false, pending: true, reason: `${label}；按 2020 规则在两回合内变着` };
      }
      if (sameMoves(expectedTail, [...firstLoop, ...firstLoop].slice(0, 4))) return resultFor(levels);
    }
  }
  return null;
}
