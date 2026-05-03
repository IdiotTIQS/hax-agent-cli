function editDistance(a, b) {
  const source = String(a || '').toLowerCase();
  const target = String(b || '').toLowerCase();
  const rows = source.length + 1;
  const columns = target.length + 1;
  const distances = Array.from({ length: rows }, () => Array(columns).fill(0));

  for (let i = 0; i < rows; i += 1) distances[i][0] = i;
  for (let j = 0; j < columns; j += 1) distances[0][j] = j;

  for (let i = 1; i < rows; i += 1) {
    for (let j = 1; j < columns; j += 1) {
      const substitutionCost = source[i - 1] === target[j - 1] ? 0 : 1;
      distances[i][j] = Math.min(
        distances[i - 1][j] + 1,
        distances[i][j - 1] + 1,
        distances[i - 1][j - 1] + substitutionCost
      );

      if (
        i > 1 &&
        j > 1 &&
        source[i - 1] === target[j - 2] &&
        source[i - 2] === target[j - 1]
      ) {
        distances[i][j] = Math.min(distances[i][j], distances[i - 2][j - 2] + 1);
      }
    }
  }

  return distances[source.length][target.length];
}

function normalizeCandidates(candidates) {
  return candidates
    .map((candidate) => {
      if (typeof candidate === 'string') return { match: candidate, suggest: candidate };
      return {
        match: candidate.match || candidate.name || candidate.value,
        suggest: candidate.suggest || candidate.name || candidate.value,
      };
    })
    .filter((candidate) => candidate.match && candidate.suggest);
}

function suggestCommand(input, candidates) {
  const command = String(input || '').replace(/^\//, '').trim();
  if (!command) return null;

  const normalizedCandidates = normalizeCandidates(candidates);
  let best = null;

  for (const candidate of normalizedCandidates) {
    const distance = editDistance(command, candidate.match);
    if (!best || distance < best.distance || (distance === best.distance && candidate.suggest.length < best.suggest.length)) {
      best = { ...candidate, distance };
    }
  }

  if (!best) return null;

  const threshold = Math.max(1, Math.min(3, Math.ceil(command.length * 0.35)));
  return best.distance <= threshold ? best.suggest : null;
}

module.exports = {
  editDistance,
  suggestCommand,
};
