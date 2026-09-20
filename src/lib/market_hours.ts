export interface MarketStatus {
  isOpen: boolean;
  isCrypto: boolean;
  statusText: string;
  badgeColor: string;
  reason?: string;
  nextOpen?: string;
  scheduleText: string;
}

/**
 * Checks whether global financial markets are currently open for a given instrument.
 * 
 * - Crypto (BTCUSD, ETHUSD, SOLUSD): 24/7/365 continuous trading.
 * - Forex (EURUSD, GBPUSD): Closes Friday 21:00 UTC (17:00 EST / New York close)
 *   and reopens Sunday 21:00 UTC (Sydney / Asian open). Closed all day Saturday.
 * - Spot Gold (XAUUSD): Closes Friday 21:00 UTC, reopens Sunday 22:00 UTC.
 *   Daily settlement rollover break: 21:00 - 22:00 UTC Monday to Thursday.
 */
export function getMarketStatus(symbol: string, date: Date = new Date()): MarketStatus {
  const sym = symbol.toUpperCase().replace('USDT', 'USD');
  const isCrypto = sym.includes('BTC') || sym.includes('ETH') || sym.includes('SOL');

  if (isCrypto) {
    return {
      isOpen: true,
      isCrypto: true,
      statusText: '24/7 LIVE',
      badgeColor: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
      scheduleText: 'Continuous 24/7 Trading'
    };
  }

  const isGold = sym.includes('XAU') || sym.includes('GOLD') || sym.includes('PAXG');
  
  const utcDay = date.getUTCDay(); // 0 = Sunday, 1 = Monday, ..., 5 = Friday, 6 = Saturday
  const utcHours = date.getUTCHours();
  const utcMinutes = date.getUTCMinutes();
  const totalMinutes = utcHours * 60 + utcMinutes;

  const nextSundayOpen = isGold ? 'Sun 22:00 UTC' : 'Sun 21:00 UTC';

  // 1. Saturday: Closed 24 hours
  if (utcDay === 6) {
    return {
      isOpen: false,
      isCrypto: false,
      statusText: 'MARKET CLOSED',
      badgeColor: 'text-rose-400 bg-rose-500/15 border-rose-500/30',
      reason: 'Weekend Market Close',
      nextOpen: nextSundayOpen,
      scheduleText: `Reopens ${nextSundayOpen}`
    };
  }

  // 2. Friday after 21:00 UTC (17:00 NY)
  if (utcDay === 5 && totalMinutes >= 21 * 60) {
    return {
      isOpen: false,
      isCrypto: false,
      statusText: 'MARKET CLOSED',
      badgeColor: 'text-rose-400 bg-rose-500/15 border-rose-500/30',
      reason: 'Friday Weekend Close',
      nextOpen: nextSundayOpen,
      scheduleText: `Reopens ${nextSundayOpen}`
    };
  }

  // 3. Sunday before Asian session open (21:00 UTC for Forex, 22:00 UTC for Gold)
  if (utcDay === 0) {
    const sundayOpenMinutes = isGold ? 22 * 60 : 21 * 60;
    if (totalMinutes < sundayOpenMinutes) {
      return {
        isOpen: false,
        isCrypto: false,
        statusText: 'MARKET CLOSED',
        badgeColor: 'text-amber-400 bg-amber-500/15 border-amber-500/30',
        reason: 'Weekend Pre-Session Break',
        nextOpen: nextSundayOpen,
        scheduleText: `Reopens ${nextSundayOpen}`
      };
    }
  }

  // 4. Gold Daily Settlement Break (21:00 - 22:00 UTC Monday to Thursday)
  if (isGold && utcDay >= 1 && utcDay <= 4 && totalMinutes >= 21 * 60 && totalMinutes < 22 * 60) {
    return {
      isOpen: false,
      isCrypto: false,
      statusText: 'DAILY BREAK',
      badgeColor: 'text-amber-400 bg-amber-500/15 border-amber-500/30',
      reason: 'Gold Daily Settlement Rollover',
      nextOpen: 'Today 22:00 UTC',
      scheduleText: 'Reopens Today 22:00 UTC'
    };
  }

  return {
    isOpen: true,
    isCrypto: false,
    statusText: 'MARKET OPEN',
    badgeColor: 'text-emerald-400 bg-emerald-500/10 border-emerald-500/20',
    scheduleText: isGold ? 'Open (Daily Break 21:00-22:00 UTC)' : 'Open (Mon - Fri 21:00 UTC)'
  };
}
