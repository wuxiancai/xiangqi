export function adjudicateRepetition(positionTrace) {
  const occurrences = new Map();
  positionTrace.forEach(({ key }, index) => {
    const indices = occurrences.get(key) ?? [];
    indices.push(index);
    occurrences.set(key, indices);
  });

  for (const indices of occurrences.values()) {
    if (indices.length < 4) continue;
    const cycle = positionTrace.slice(indices.at(-4) + 1, indices.at(-1) + 1);
    const checkingSides = ['red', 'black'].filter((side) => {
      const sideMoves = cycle.filter((entry) => entry.mover === side);
      return sideMoves.length > 0 && sideMoves.every((entry) => entry.gaveCheck);
    });
    if (checkingSides.length === 1) {
      const loser = checkingSides[0];
      return { over: true, loser, winner: loser === 'red' ? 'black' : 'red', reason: '长将判负' };
    }
  }
  return null;
}
