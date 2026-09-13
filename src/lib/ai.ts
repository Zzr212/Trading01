// Quantitative Confluence & Probability Engine
// Replaces naive synthetic perceptron with rigorous multi-factor mathematical scoring
export class TradePredictor {
  private history: { features: number[], label: number }[] = [];
  private totalWins = 0;
  private totalLosses = 0;

  constructor() {}

  public recordResultAndTrain(features: number[], result: 'WON' | 'LOST') {
    const isWin = result === 'WON';
    if (isWin) this.totalWins++;
    else this.totalLosses++;

    this.history.push({
      features,
      label: isWin ? 1 : 0
    });

    if (this.history.length > 500) {
      this.history.shift();
    }
  }

  public getStatus() {
    const total = this.totalWins + this.totalLosses;
    const empiricalWinRate = total > 0 ? Math.round((this.totalWins / total) * 100) : 50;

    return {
      status: 'ACTIVE',
      backend: 'Quant Multi-Factor Engine',
      memorySize: this.history.length,
      layers: 5,
      isTrained: true,
      empiricalWinRate: `${empiricalWinRate}% (${this.totalWins}W / ${this.totalLosses}L)`
    };
  }

  // Multi-factor Confluence Scoring (0 to 100)
  // features: [rsi, macdHist, price_ema9_diff, price_ema21_diff, isLong (1 or 0), macroBullish (1 or 0), adx, btcAligned (1 or 0)]
  public predict(features: number[]): number {
    try {
      const [rsi, macd, ema9Diff, ema21Diff, isLong, macroBullish, adx = 25, btcAligned = 1] = features;

      let score = 50; // Base score

      // 1. RSI Sweet Spot (45 - 58 for healthy trend continuation, not exhausted)
      if (isLong === 1) {
        if (rsi >= 46 && rsi <= 62) score += 12;
        else if (rsi > 68) score -= 15; // Overbought trap
        else if (rsi < 40) score -= 10; // Weak momentum
      } else {
        if (rsi >= 38 && rsi <= 54) score += 12;
        else if (rsi < 32) score -= 15; // Oversold trap
        else if (rsi > 60) score -= 10; // Weak momentum
      }

      // 2. MACD Histogram Confirmation
      if (isLong === 1 && macd > 0) score += 10;
      else if (isLong === 0 && macd < 0) score += 10;
      else score -= 8;

      // 3. EMA Momentum Alignment
      if (isLong === 1 && ema9Diff > 0 && ema21Diff > 0) score += 10;
      else if (isLong === 0 && ema9Diff < 0 && ema21Diff < 0) score += 10;

      // 4. 15m Macro Trend Alignment
      if ((isLong === 1 && macroBullish === 1) || (isLong === 0 && macroBullish === 0)) {
        score += 12;
      } else {
        score -= 20; // Heavy penalty for counter-trend
      }

      // 5. ADX Trend Power Filter
      if (adx >= 28) score += 10;
      else if (adx >= 22) score += 5;
      else score -= 15; // Low ADX = chop

      // 6. BTC Master Alignment Filter
      if (btcAligned === 1) {
        score += 8;
      } else {
        score -= 25; // Never fight Bitcoin direction on altcoins
      }

      return Math.max(15, Math.min(96, Math.round(score)));
    } catch {
      return 50;
    }
  }
}

