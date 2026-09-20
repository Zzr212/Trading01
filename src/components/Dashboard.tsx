import React, { useEffect, useState, useMemo, useRef } from 'react';
import { Activity, Menu, Server, ChevronRight, X, ShieldCheck, Zap, Clock, TrendingUp } from 'lucide-react';
import SystemDiagnosticsModal from './SystemDiagnosticsModal';
import { MT5BridgeModal } from './MT5BridgeModal';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';
import { getMarketStatus } from '../lib/market_hours';

interface PairStats {
  pair: string;
  won: number;
  lost: number;
  active: number;
  currentPrice: number;
}

const COLORS: Record<string, string> = {
  'BTCUSD': '#F7931A',
  'ETHUSD': '#627EEA',
  'XAUUSD': '#E5B83B',
  'EURUSD': '#2563EB',
  'GBPUSD': '#9333EA',
  'SOLUSD': '#14F195',
  'BTCUSDT': '#F7931A',
  'ETHUSDT': '#627EEA',
  'PAXGUSDT': '#E5B83B',
  'EURUSDT': '#2563EB',
  'GBPUSDT': '#9333EA',
  'SOLUSDT': '#14F195'
};

const PAIR_INFO: Record<string, { label: string, badge: string, tagColor: string }> = {
  'BTCUSD': { label: 'Flagship Crypto • Momentum Trend', badge: 'CRYPTO', tagColor: 'text-amber-400 bg-amber-400/10 border-amber-500/20' },
  'ETHUSD': { label: 'High Liquidity • VWAP & EMA Wave', badge: 'CRYPTO', tagColor: 'text-indigo-400 bg-indigo-400/10 border-indigo-500/20' },
  'XAUUSD': { label: 'Gold Spot • Low Spread Commodity', badge: 'GOLD', tagColor: 'text-yellow-400 bg-yellow-400/10 border-yellow-500/20' },
  'EURUSD': { label: 'Global Major #1 • Ultra Tight Spread', badge: 'FOREX', tagColor: 'text-blue-400 bg-blue-400/10 border-blue-500/20' },
  'GBPUSD': { label: 'High Volatility • Clean Trend Breaks', badge: 'FOREX', tagColor: 'text-purple-400 bg-purple-400/10 border-purple-500/20' },
  'SOLUSD': { label: 'High Beta • Volume Breakouts', badge: 'CRYPTO', tagColor: 'text-emerald-400 bg-emerald-400/10 border-emerald-500/20' }
};

const PAIRS = ['BTCUSD', 'ETHUSD', 'XAUUSD', 'EURUSD', 'GBPUSD', 'SOLUSD'];

const toBinance = (p: string) => {
  if (p === 'XAUUSD' || p === 'GOLD') return 'PAXGUSDT';
  if (p === 'EURUSD') return 'EURUSDT';
  if (p === 'GBPUSD') return 'GBPUSDT';
  if (p.endsWith('USDT')) return p;
  if (p.endsWith('USD')) return `${p}T`;
  return `${p}USDT`;
};

const fromBinance = (s: string) => {
  if (s === 'PAXGUSDT' || s === 'PAXGUSD') return 'XAUUSD';
  if (s === 'EURUSDT') return 'EURUSD';
  if (s === 'GBPUSDT') return 'GBPUSD';
  if (s.endsWith('USDT')) return s.slice(0, -1);
  return s;
};

interface Props {
  onSelectPair: (pair: string) => void;
}

export default function Dashboard({ onSelectPair }: Props) {
  const [stats, setStats] = useState<Record<string, {won: number, lost: number, active: number}>>({});
  const [prices, setPrices] = useState<Record<string, number>>({});
  const [showDiagnostics, setShowDiagnostics] = useState<boolean>(false);
  const [showMT5Bridge, setShowMT5Bridge] = useState<boolean>(false);
  const [showMenu, setShowMenu] = useState<boolean>(false);
  const [mt5Connected, setMt5Connected] = useState<boolean>(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // Fetch stats
    fetch('/api/stats')
      .then(r => r.json())
      .then(data => {
        setStats(data || {});
      })
      .catch(console.error);

    // Fetch initial prices and start WS for live prices
    const fetchPrices = async () => {
      try {
        const res = await fetch('https://api.binance.com/api/v3/ticker/price');
        const data = await res.json();
        const priceMap: Record<string, number> = {};
        if (Array.isArray(data)) {
          data.forEach(d => {
            const clean = fromBinance(d.symbol);
            if (PAIRS.includes(clean)) {
              priceMap[clean] = parseFloat(d.price);
            }
          });
          setPrices(priceMap);
        }
      } catch (e) {}
    };
    fetchPrices();

    const streams = PAIRS.map(p => `${toBinance(p).toLowerCase()}@ticker`).join('/');
    const ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);
    
    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.data && payload.data.s && payload.data.c) {
          const clean = fromBinance(payload.data.s);
          const price = parseFloat(payload.data.c);
          if (PAIRS.includes(clean)) {
            setPrices(prev => ({ ...prev, [clean]: price }));
          }
        }
      } catch (e) {}
    };

    // Check MT5 connection status
    const checkMT5 = () => {
      fetch('/api/mt5/config')
        .then(r => r.json())
        .then(data => {
          if (data.status) {
            setMt5Connected(!!data.status.connected);
          }
        })
        .catch(() => {});
    };
    checkMT5();
    const mt5Interval = setInterval(checkMT5, 10000);

    return () => {
      ws.close();
      clearInterval(mt5Interval);
    };
  }, []);

  const donutData = useMemo(() => {
    return PAIRS.map(pair => {
      const pStats = stats[pair] || { won: 0, lost: 0 };
      return {
        name: pair,
        value: pStats.won,
        color: COLORS[pair] || '#8884d8'
      };
    }).filter(d => d.value > 0);
  }, [stats]);

  // If no trades yet, show dummy data for donut to look nice
  const displayDonutData = donutData.length > 0 ? donutData : PAIRS.map(pair => ({
    name: pair,
    value: 1, // equal slice
    color: COLORS[pair] || '#8884d8',
    isDummy: true
  }));

  const totalWins = PAIRS.reduce((acc, p) => acc + (stats[p]?.won || 0), 0);
  const totalLosses = PAIRS.reduce((acc, p) => acc + (stats[p]?.lost || 0), 0);
  const totalTradesCount = totalWins + totalLosses;
  const totalWinRate = totalTradesCount > 0 ? ((totalWins / totalTradesCount) * 100).toFixed(1) : '0.0';

  return (
    <div className="h-[100dvh] w-full bg-neutral-950 flex flex-col font-sans text-white overflow-y-auto">
      {/* Top Section - Statistics & Navigation Header */}
      <div className="w-full border-b border-neutral-900 flex flex-col lg:flex-row items-center p-4 lg:p-8 bg-neutral-950/80 backdrop-blur-xl shadow-lg z-10 relative">
        
        {/* Top-Right Hamburger Button */}
        <div className="absolute top-4 right-4 z-40">
          <button
            onClick={() => setShowMenu(true)}
            aria-label="Toggle system navigation menu"
            className="flex items-center gap-2 px-3 py-2 sm:px-3.5 sm:py-2.5 rounded-xl bg-neutral-900/95 hover:bg-neutral-850 border border-neutral-800 hover:border-neutral-700 text-neutral-200 hover:text-white transition-all shadow-md active:scale-95 group backdrop-blur-md cursor-pointer relative"
          >
            <div className="flex items-center gap-2">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span className="text-xs font-medium tracking-tight text-neutral-300 group-hover:text-white hidden sm:inline">
                Control Hub
              </span>
            </div>
            <div className="w-px h-4 bg-neutral-800 mx-0.5 hidden sm:block"></div>
            <Menu size={18} className="text-neutral-300 group-hover:text-white transition-transform" />
          </button>
        </div>

        {/* Left Side: Donut Chart with Total Wins / Losses & Win Rate % */}
        <div className="h-64 lg:h-80 w-full lg:w-1/3 flex items-center justify-center relative mb-6 lg:mb-0">
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                isAnimationActive={false}
                data={displayDonutData}
                innerRadius="75%"
                outerRadius="100%"
                paddingAngle={5}
                dataKey="value"
                stroke="#0a0a0a" strokeWidth={4}
              >
                {displayDonutData.map((entry, index) => (
                  <Cell key={`cell-${index}`} fill={entry.color} opacity={('isDummy' in entry) ? 0.2 : 1} />
                ))}
              </Pie>
              <Tooltip 
                formatter={(value: number, name: string, props: any) => {
                  if (props.payload.isDummy) return ['No won trades yet', name];
                  return [`${value} Won Trades`, name];
                }}
                contentStyle={{ backgroundColor: '#171717', border: 'none', borderRadius: '8px', color: '#fff' }}
                itemStyle={{ color: '#fff' }}
              />
            </PieChart>
          </ResponsiveContainer>

          {/* Center Text: Wins / Losses and Win Rate % */}
          <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none text-center">
            <div className="flex items-baseline gap-1.5">
              <span className="text-3xl lg:text-4xl font-black font-mono text-emerald-400 drop-shadow-sm">{totalWins}</span>
              <span className="text-xl lg:text-2xl font-bold font-mono text-neutral-600">/</span>
              <span className="text-2xl lg:text-3xl font-black font-mono text-rose-500 drop-shadow-sm">{totalLosses}</span>
            </div>
            <span className="text-[11px] font-mono tracking-wider uppercase text-neutral-400 mt-0.5">
              Wins <span className="text-neutral-600">/</span> Losses
            </span>
            <div className="mt-1.5 px-2.5 py-0.5 rounded-full bg-neutral-900 border border-neutral-800 text-[11px] font-mono font-semibold text-emerald-400">
              {totalWinRate}% Win Rate
            </div>
            <span className="text-[9px] text-neutral-500 font-mono mt-0.5">({totalTradesCount} total)</span>
          </div>
        </div>

        {/* Right Side: Pair Summary (2 rows) */}
        <div className="w-full lg:w-2/3 lg:pl-10 flex items-center">
          <div className="grid grid-cols-2 md:grid-cols-3 gap-3 sm:gap-4 lg:gap-6 w-full">
            {PAIRS.map(pair => {
              const pStats = stats[pair] || { won: 0, lost: 0 };
              const total = pStats.won + pStats.lost;
              const winRate = total > 0 ? Math.round((pStats.won / total) * 100) : 0;
              const marketStatus = getMarketStatus(pair);

              return (
                <div key={pair} className="flex items-center gap-3 bg-neutral-900/50 rounded-xl p-3 border border-neutral-800/50">
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: COLORS[pair] }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <span className="text-sm font-bold text-neutral-200 truncate">{pair}</span>
                      <span className={`text-[8px] font-mono font-bold px-1 rounded border ${marketStatus.isOpen ? (PAIR_INFO[pair]?.tagColor || 'text-neutral-400 bg-neutral-900 border-neutral-800') : 'text-rose-400 bg-rose-500/10 border-rose-500/20'}`}>
                        {marketStatus.isOpen ? (PAIR_INFO[pair]?.badge || 'ASSET') : 'CLOSED'}
                      </span>
                    </div>
                    <div className="text-xs text-neutral-500 truncate mt-0.5">
                      W: <span className="text-emerald-400 font-mono">{pStats.won}</span> / 
                      L: <span className="text-rose-400 font-mono">{pStats.lost}</span> 
                      <span className="ml-2 font-mono text-neutral-400">{total > 0 ? `${winRate}%` : '--%'}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      </div>

      {/* Bottom Section - Watchlist (Clean Title & Market Closed Tags) */}
      <div className="flex-1 w-full max-w-7xl mx-auto bg-neutral-950 p-4 lg:p-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-neutral-200 tracking-tight">Watchlist</h2>
        </div>

        <div className="grid gap-3">
          {PAIRS.map(pair => {
             const pStats = stats[pair] || { won: 0, lost: 0 };
             const total = pStats.won + pStats.lost;
             const winRate = total > 0 ? Math.round((pStats.won / total) * 100) : 0;
             const price = prices[pair] || 0;
             const info = PAIR_INFO[pair];
             const marketStatus = getMarketStatus(pair);
             
             return (
               <div 
                 key={pair} 
                 onClick={() => onSelectPair(pair)}
                 className={`group flex flex-col sm:flex-row sm:items-center justify-between p-4 lg:p-5 rounded-2xl bg-neutral-900/60 border ${
                   marketStatus.isOpen 
                     ? 'border-neutral-800 hover:border-blue-500/50 hover:bg-neutral-850 hover:shadow-[0_8px_30px_rgba(59,130,246,0.1)]' 
                     : 'border-neutral-850/80 hover:border-neutral-700 bg-neutral-900/40 opacity-90'
                 } cursor-pointer transition-all`}
               >
                 <div className="flex items-center gap-4 mb-3 sm:mb-0">
                   <div 
                     className="w-12 h-12 rounded-2xl flex items-center justify-center font-bold text-xs font-mono shadow-inner flex-shrink-0" 
                     style={{ backgroundColor: `${COLORS[pair]}15`, color: COLORS[pair], border: `1px solid ${COLORS[pair]}40` }}
                   >
                     {pair.replace('USD', '')}
                   </div>
                   <div>
                     <div className="flex items-center gap-2 flex-wrap">
                       <span className="text-lg sm:text-xl font-bold tracking-tight text-white">{pair}</span>
                       <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold border ${info?.tagColor || 'text-neutral-400 bg-neutral-900 border-neutral-800'}`}>
                         {info?.badge || 'ASSET'}
                       </span>
                       
                       {/* Market Open/Closed Badge */}
                       <span className={`text-[9px] font-mono px-2 py-0.5 rounded-full font-bold border ${marketStatus.badgeColor}`}>
                         {marketStatus.statusText}
                       </span>

                       {pStats.active > 0 && (
                         <div className="relative flex h-2.5 w-2.5" title="Active Trade Running">
                           <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                           <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                         </div>
                       )}
                     </div>

                     <div className="text-xs text-neutral-400 mt-1 flex items-center gap-2 flex-wrap">
                       <span>{info?.label || 'Quantitative Algorithmic Trading'}</span>
                       {!marketStatus.isOpen && (
                         <span className="text-amber-400/90 font-mono text-[11px] font-medium flex items-center gap-1">
                           • <Clock size={11} /> {marketStatus.scheduleText}
                         </span>
                       )}
                     </div>
                   </div>
                 </div>
                 
                 <div className="flex items-center justify-between sm:justify-end sm:gap-10 lg:gap-12 w-full sm:w-auto border-t sm:border-t-0 border-neutral-800/50 pt-3 sm:pt-0">
                   <div className="text-left sm:text-right">
                     <div className="text-xs text-neutral-500 mb-0.5">Win Rate</div>
                     <div className="font-mono flex items-center gap-1.5">
                       <span className="text-emerald-400 font-bold">{pStats.won}W</span>
                       <span className="text-neutral-600">-</span>
                       <span className="text-rose-400 font-bold">{pStats.lost}L</span>
                       <span className="bg-neutral-950 px-2 py-0.5 rounded text-xs ml-1.5 border border-neutral-800 font-semibold text-neutral-200">
                         {total > 0 ? `${winRate}%` : '--%'}
                       </span>
                     </div>
                   </div>
                   
                   <div className="text-right min-w-[120px]">
                     <div className="text-xs text-neutral-500 mb-0.5">Market Price</div>
                     <div className="font-mono text-lg sm:text-xl font-bold text-neutral-100">
                       {price > 0 ? (price < 5 ? `$${price.toFixed(4)}` : `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`) : '...'}
                     </div>
                   </div>
                 </div>
               </div>
             );
          })}
        </div>
      </div>

      {/* FULL PAGE / DRAWER HAMBURGER MENU FROM THE RIGHT (Solid Black Background) */}
      {showMenu && (
        <div className="fixed inset-0 z-50 flex justify-end bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
          {/* Backdrop Click */}
          <div className="absolute inset-0" onClick={() => setShowMenu(false)} />

          {/* Pure Black Side Drawer Container */}
          <div 
            ref={menuRef}
            className="relative z-10 w-full sm:max-w-md h-full bg-black text-white flex flex-col shadow-2xl border-l border-neutral-900 overflow-y-auto animate-in slide-in-from-right duration-250 ease-out"
          >
            {/* Header */}
            <div className="sticky top-0 z-20 bg-black/95 backdrop-blur-lg border-b border-neutral-900 px-5 py-4 flex items-center justify-between">
              <div className="flex items-center gap-2.5">
                <div className="w-2.5 h-2.5 rounded-full bg-emerald-500 shadow-[0_0_10px_rgba(16,185,129,0.7)] animate-pulse"></div>
                <div>
                  <h3 className="font-bold text-sm tracking-tight text-white uppercase font-mono">Control & System Hub</h3>
                  <p className="text-[10px] text-neutral-500 font-mono">Quant Engine Architecture v2.5</p>
                </div>
              </div>
              <button
                onClick={() => setShowMenu(false)}
                aria-label="Close menu"
                className="p-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-neutral-400 hover:text-white border border-neutral-800 transition-colors cursor-pointer"
              >
                <X size={20} />
              </button>
            </div>

            {/* Content Body inside Black Menu */}
            <div className="p-5 space-y-4 flex-1">
              
              {/* Option 1: System Diagnostics & Health Check */}
              <button
                onClick={() => {
                  setShowMenu(false);
                  setShowDiagnostics(true);
                }}
                className="w-full p-4 rounded-2xl bg-neutral-950 hover:bg-neutral-900 border border-neutral-850 hover:border-emerald-500/40 text-left transition-all group cursor-pointer shadow-lg"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3.5">
                    <div className="p-2.5 rounded-xl bg-neutral-900 border border-neutral-800 text-emerald-400 group-hover:bg-emerald-950/30 group-hover:border-emerald-500/40 transition-all shrink-0">
                      <Activity size={20} />
                    </div>
                    <div>
                      <div className="font-bold text-white text-sm flex items-center gap-2">
                        System Diagnostics & Health
                      </div>
                      <p className="text-xs text-neutral-400 mt-1 leading-relaxed">
                        Live scan of Confluence Engine, SQLite DB latency, WebSocket streams & memory.
                      </p>
                    </div>
                  </div>
                  <ChevronRight size={18} className="text-neutral-600 group-hover:text-emerald-400 group-hover:translate-x-1 transition-all shrink-0 mt-1" />
                </div>
              </button>

              {/* Option 2: MetaTrader 5 Bridge */}
              <button
                onClick={() => {
                  setShowMenu(false);
                  setShowMT5Bridge(true);
                }}
                className="w-full p-4 rounded-2xl bg-neutral-950 hover:bg-neutral-900 border border-neutral-850 hover:border-blue-500/40 text-left transition-all group cursor-pointer shadow-lg"
              >
                <div className="flex items-start justify-between">
                  <div className="flex items-start gap-3.5">
                    <div className="p-2.5 rounded-xl bg-neutral-900 border border-neutral-800 text-blue-400 group-hover:bg-blue-950/30 group-hover:border-blue-500/40 transition-all shrink-0">
                      <Server size={20} />
                    </div>
                    <div>
                      <div className="font-bold text-white text-sm flex items-center gap-2">
                        MetaTrader 5 Bridge Hub
                        <span className={`w-2 h-2 rounded-full ${mt5Connected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`}></span>
                      </div>
                      <p className="text-xs text-neutral-400 mt-1 leading-relaxed">
                        Vantage auto-lot size config, Oracle VPS IP sync, MQL5 EA code generator & live terminal telemetry.
                      </p>
                    </div>
                  </div>
                  <ChevronRight size={18} className="text-neutral-600 group-hover:text-blue-400 group-hover:translate-x-1 transition-all shrink-0 mt-1" />
                </div>
              </button>

              {/* Option 3: Market Hours & Weekend Auto-Guard */}
              <div className="p-4 rounded-2xl bg-neutral-950 border border-neutral-850 space-y-3">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-amber-400 font-semibold text-xs">
                    <Clock size={16} />
                    <span>Market Hours & Weekend Guard</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-400 border border-amber-500/20">
                    AUTOMATIC
                  </span>
                </div>
                <p className="text-xs text-neutral-400 leading-relaxed">
                  Bot automatski prepoznaje vikend pauzu za Forex (EURUSD, GBPUSD) i Zlato (XAUUSD) od petka 21:00 UTC do nedelje 21:00 UTC. Kripto parovi (BTC, ETH, SOL) trguju neprekidno 24/7.
                </p>
                <div className="grid grid-cols-2 gap-2 pt-1 font-mono text-[11px]">
                  <div className="p-2 rounded-lg bg-neutral-900 border border-neutral-800 flex justify-between items-center">
                    <span className="text-neutral-300">Crypto (BTC, ETH, SOL)</span>
                    <span className="text-emerald-400 font-bold">24/7 LIVE</span>
                  </div>
                  <div className="p-2 rounded-lg bg-neutral-900 border border-neutral-800 flex justify-between items-center">
                    <span className="text-neutral-300">Forex & Spot Gold</span>
                    <span className="text-amber-400 font-bold">MON-FRI</span>
                  </div>
                </div>
              </div>

              {/* Option 4: Risk Protocol Card */}
              <div className="p-4 rounded-2xl bg-neutral-950 border border-neutral-850 space-y-2.5">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2 text-purple-400 font-semibold text-xs">
                    <ShieldCheck size={16} />
                    <span>Spread & R:R Protection Protocol</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/20">
                    PROTECTED
                  </span>
                </div>
                <div className="text-xs text-neutral-400 space-y-1.5 leading-relaxed">
                  <div className="flex justify-between border-b border-neutral-900 pb-1">
                    <span>Min Risk/Reward:</span>
                    <span className="font-mono text-white font-bold">1.85 : 1 (do 3.6 : 1)</span>
                  </div>
                  <div className="flex justify-between border-b border-neutral-900 pb-1">
                    <span>TP1 Partial Profit:</span>
                    <span className="font-mono text-emerald-400 font-semibold">50% Out + Break-Even</span>
                  </div>
                  <div className="flex justify-between border-b border-neutral-900 pb-1">
                    <span>Trailing Stop:</span>
                    <span className="font-mono text-emerald-400 font-semibold">75% TP Target Distance</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Loss Protection:</span>
                    <span className="font-mono text-white font-semibold">35m Cool-off per pair</span>
                  </div>
                </div>
              </div>

            </div>

            {/* Menu Footer */}
            <div className="sticky bottom-0 bg-black/95 border-t border-neutral-900 p-4 flex items-center justify-between text-[11px] font-mono text-neutral-500">
              <span>Terminal Status:</span>
              <span className={mt5Connected ? "text-emerald-400 font-semibold flex items-center gap-1.5" : "text-amber-400/90 font-semibold flex items-center gap-1.5"}>
                <span className={`w-2 h-2 rounded-full ${mt5Connected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`}></span>
                {mt5Connected ? "MT5 TERMINAL SYNCED" : "WAITING EA PULSE"}
              </span>
            </div>
          </div>
        </div>
      )}

      {/* Diagnostics Modal */}
      <SystemDiagnosticsModal
        isOpen={showDiagnostics}
        onClose={() => setShowDiagnostics(false)}
      />

      {/* MT5 System Bridge Modal */}
      <MT5BridgeModal
        isOpen={showMT5Bridge}
        onClose={() => setShowMT5Bridge(false)}
      />
    </div>
  );
}
