export interface MonthlyTile {
  month: number;
  year: number;
  label: string;
  date: string; // YYYY-MM-DD
  price: number | null;
  currency: string;
  stops: number | null;
  duration: number | null;
  providerCode?: string | null;
  providerOfferId?: string | null;
  monthlyScoreRaw?: number;
  monthlyScoreDisplay?: number;
  monthlyBadges?: string[];
  monthlyReasons?: string[];
  scoreBreakdown?: any;
}

export function rankMonthlyFareTiles(tiles: MonthlyTile[]) {
  const validTiles = tiles.filter(
    (t) => t.price !== null && t.duration !== null && t.stops !== null
  );

  if (validTiles.length === 0) {
    return { rankedTiles: tiles, badgeWinners: {}, metadata: {} };
  }

  // 1. Calculate min/max for normalization
  const prices = validTiles.map((t) => t.price!);
  const durations = validTiles.map((t) => t.duration!);
  const stopsCounts = validTiles.map((t) => t.stops!);

  const minPrice = Math.min(...prices);
  const maxPrice = Math.max(...prices);
  const fastestDuration = Math.min(...durations);
  const maxDuration = Math.max(...durations);
  const lowestStops = Math.min(...stopsCounts);
  const highestStops = Math.max(...stopsCounts);

  const priceRange = maxPrice - minPrice || 1;
  const durationRange = maxDuration - fastestDuration || 1;

  // 2. Score each tile
  validTiles.forEach((tile) => {
    const tilePrice = tile.price!;
    const tileDuration = tile.duration!;
    const totalStops = tile.stops!;

    // -- Price Score (35%)
    let priceScore = 100 * ((maxPrice - tilePrice) / priceRange);
    if (tilePrice === maxPrice && maxPrice === minPrice) priceScore = 100;
    // Guardrails
    if (tilePrice <= minPrice * 1.03) priceScore = Math.max(priceScore, 93);
    else if (tilePrice <= minPrice * 1.05) priceScore = Math.max(priceScore, 88);

    // -- Duration Score (30%)
    let durationScore = 100 * ((maxDuration - tileDuration) / durationRange);
    if (tileDuration === maxDuration && maxDuration === fastestDuration) durationScore = 100;
    // Guardrails
    if (tileDuration <= fastestDuration * 1.1) durationScore = Math.max(durationScore, 90);
    if (tileDuration > fastestDuration * 8) durationScore = Math.min(durationScore, 5);
    else if (tileDuration > fastestDuration * 5) durationScore = Math.min(durationScore, 15);
    else if (tileDuration > fastestDuration * 2) durationScore = Math.min(durationScore, 40);

    // -- Stops Score (18%)
    let stopsScore = 20;
    if (totalStops === 0) stopsScore = 100;
    else if (totalStops === 1) stopsScore = 85;
    else if (totalStops === 2) stopsScore = 70;
    else if (totalStops === 3) stopsScore = 50;
    else if (totalStops === 4) stopsScore = 35;

    // -- Convenience Score (7%)
    let convenienceScore = 100;
    if (tileDuration > fastestDuration * 2) convenienceScore -= 30;
    if (tileDuration > fastestDuration * 5) convenienceScore -= 30; // cumulative -60
    if (totalStops >= 4) convenienceScore -= 20;
    if (totalStops >= 5) convenienceScore -= 10; // cumulative -30
    convenienceScore = Math.max(0, convenienceScore);

    // -- Fare Quality (5%), Provider Reliability (3%), Data Confidence (2%)
    const fareQualityScore = 55;
    let providerReliabilityScore = 80;
    if (tile.providerCode?.toLowerCase() === 'duffel') providerReliabilityScore = 95;
    else if (tile.providerCode?.toLowerCase() === 'mystifly') providerReliabilityScore = 90;
    const dataConfidenceScore = 80;

    const monthlyScoreRaw =
      priceScore * 0.35 +
      durationScore * 0.3 +
      stopsScore * 0.18 +
      convenienceScore * 0.07 +
      fareQualityScore * 0.05 +
      providerReliabilityScore * 0.03 +
      dataConfidenceScore * 0.02;

    tile.monthlyScoreRaw = monthlyScoreRaw;
    tile.monthlyScoreDisplay = Math.round(monthlyScoreRaw);
    tile.scoreBreakdown = {
      priceScore,
      durationScore,
      stopsScore,
      convenienceScore,
      fareQualityScore,
      providerReliabilityScore,
      dataConfidenceScore,
    };
    tile.monthlyBadges = [];
    tile.monthlyReasons = [];
  });

  // 3. Determine Cheapest
  const cheapestCandidates = validTiles.filter((t) => t.price === minPrice);
  cheapestCandidates.sort((a, b) => {
    if (b.monthlyScoreRaw! !== a.monthlyScoreRaw!) return b.monthlyScoreRaw! - a.monthlyScoreRaw!;
    if (a.duration! !== b.duration!) return a.duration! - b.duration!;
    if (a.stops! !== b.stops!) return a.stops! - b.stops!;
    if (a.year !== b.year) return a.year - b.year;
    return a.month - b.month;
  });
  const cheapestTile = cheapestCandidates[0];
  cheapestTile.monthlyBadges!.push('Cheapest');
  cheapestTile.monthlyReasons!.push('Lowest fare among the monthly options');

  // 4. Determine Fastest
  const fastestCandidates = validTiles.filter((t) => t.duration === fastestDuration);
  fastestCandidates.sort((a, b) => {
    if (a.price! !== b.price!) return a.price! - b.price!;
    if (a.stops! !== b.stops!) return a.stops! - b.stops!;
    if (b.monthlyScoreRaw! !== a.monthlyScoreRaw!) return b.monthlyScoreRaw! - a.monthlyScoreRaw!;
    if (a.year !== b.year) return a.year - b.year;
    return a.month - b.month;
  });
  const fastestTile = fastestCandidates[0];
  fastestTile.monthlyBadges!.push('Fastest');
  fastestTile.monthlyReasons!.push('Fastest travel time across all shown months');

  // 5. Determine AI Pick
  // Exclude extremely long itineraries from AI Pick
  let aiCandidates = validTiles.filter((t) => t.duration! <= fastestDuration * 5);
  if (aiCandidates.length === 0) aiCandidates = validTiles; // Fallback if all are terrible

  aiCandidates.sort((a, b) => {
    const diff = b.monthlyScoreRaw! - a.monthlyScoreRaw!;
    if (Math.abs(diff) <= 2) {
      // Tie breakers
      if (a.price! !== b.price!) return a.price! - b.price!;
      if (Math.abs(a.price! - b.price!) / a.price! <= 0.03) {
        if (a.duration! !== b.duration!) {
          return a.duration! - b.duration!;
        }
      }
      if (Math.abs(a.duration! - b.duration!) <= 30) {
        if (a.stops! !== b.stops!) return a.stops! - b.stops!;
      }
      if (a.year !== b.year) return a.year - b.year;
      return a.month - b.month;
    }
    return diff;
  });

  const aiPickTile = aiCandidates[0];
  aiPickTile.monthlyBadges!.unshift('AI Pick');
  aiPickTile.monthlyReasons!.unshift('Best overall value combining price and convenience');

  return {
    rankedTiles: tiles,
    badgeWinners: {
      aiPickMonth: `${aiPickTile.year}-${aiPickTile.month}`,
      cheapestMonth: `${cheapestTile.year}-${cheapestTile.month}`,
      fastestMonth: `${fastestTile.year}-${fastestTile.month}`,
    },
    metadata: {
      minPrice,
      maxPrice,
      fastestDuration,
      maxDuration,
      lowestStops,
      highestStops,
    },
  };
}
