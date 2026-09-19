import React, { useEffect, useState, useMemo, useRef } from 'react';
import { Activity, Menu, Server, ChevronRight, X, ShieldCheck, Zap } from 'lucide-react';
import SystemDiagnosticsModal from './SystemDiagnosticsModal';
import { MT5BridgeModal } from './MT5BridgeModal';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip } from 'recharts';

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

    // Close hamburger menu when clicking outside
    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setShowMenu(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);

    return () => {
      ws.close();
      clearInterval(mt5Interval);
      document.removeEventListener('mousedown', handleClickOutside);
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
      {/* Top 35% - Statistics & Navigation Header */}
      <div className="w-full border-b border-neutral-900 flex flex-col lg:flex-row items-center p-4 lg:p-8 bg-neutral-950/80 backdrop-blur-xl shadow-lg z-10 relative">
        
        {/* Top-Right Modern Classic Hamburger Menu */}
        <div className="absolute top-4 right-4 z-40" ref={menuRef}>
          <button
            onClick={() => setShowMenu(prev => !prev)}
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
            {showMenu ? (
              <X size={18} className="text-neutral-300 group-hover:text-white transition-transform" />
            ) : (
              <Menu size={18} className="text-neutral-300 group-hover:text-white transition-transform" />
            )}
          </button>

          {/* Hamburger Dropdown Drawer / Panel */}
          {showMenu && (
            <div className="absolute right-0 mt-2.5 w-[calc(100vw-2rem)] sm:w-80 max-w-sm bg-neutral-925/95 border border-neutral-800/90 rounded-2xl shadow-2xl p-2.5 text-xs backdrop-blur-2xl z-50 animate-in fade-in slide-in-from-top-2 duration-200">
              {/* Header inside menu */}
              <div className="px-3 py-2.5 mb-1 border-b border-neutral-800/80 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_8px_rgba(16,185,129,0.6)]"></div>
                  <span className="font-semibold tracking-wide text-neutral-200 text-xs uppercase font-mono">
                    System Architecture
                  </span>
                </div>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-mono font-medium bg-neutral-900 border border-neutral-800 text-neutral-400">
                  v2.50
                </span>
              </div>

              {/* Menu Navigation Options */}
              <div className="space-y-1.5 py-1">
                {/* Option 1: System Diagnostics */}
                <button
                  onClick={() => {
                    setShowMenu(false);
                    setShowDiagnostics(true);
                  }}
                  className="w-full min-h-[48px] flex items-center justify-between p-2.5 rounded-xl bg-neutral-900/40 hover:bg-neutral-850/80 border border-transparent hover:border-neutral-800 text-neutral-300 hover:text-white transition-all group cursor-pointer text-left"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-neutral-900 border border-neutral-800 text-emerald-400 group-hover:border-emerald-500/40 group-hover:bg-emerald-950/20 transition-all">
                      <Activity size={16} />
                    </div>
                    <div>
                      <div className="font-semibold text-neutral-200 group-hover:text-white text-xs">
                        System Diagnostics & Health
                      </div>
                      <div className="text-[10px] text-neutral-500">
                        Live bot telemetry, DB latency & AI engine
                      </div>
                    </div>
                  </div>
                  <ChevronRight size={15} className="text-neutral-600 group-hover:text-neutral-300 group-hover:translate-x-0.5 transition-all flex-shrink-0" />
                </button>

                {/* Option 2: MT5 Bridge Hub */}
                <button
                  onClick={() => {
                    setShowMenu(false);
                    setShowMT5Bridge(true);
                  }}
                  className="w-full min-h-[48px] flex items-center justify-between p-2.5 rounded-xl bg-neutral-900/40 hover:bg-neutral-850/80 border border-transparent hover:border-neutral-800 text-neutral-300 hover:text-white transition-all group cursor-pointer text-left"
                >
                  <div className="flex items-center gap-3">
                    <div className="p-2 rounded-lg bg-neutral-900 border border-neutral-800 text-blue-400 group-hover:border-blue-500/40 group-hover:bg-blue-950/20 transition-all">
                      <Server size={16} />
                    </div>
                    <div>
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-neutral-200 group-hover:text-white text-xs">
                          MetaTrader 5 Bridge Hub
                        </span>
                        <span className={`h-1.5 w-1.5 rounded-full ${mt5Connected ? 'bg-emerald-400' : 'bg-amber-400'}`}></span>
                      </div>
                      <div className="text-[10px] text-neutral-500">
                        Vantage auto-lot, EA generator & sync
                      </div>
                    </div>
                  </div>
                  <ChevronRight size={15} className="text-neutral-600 group-hover:text-neutral-300 group-hover:translate-x-0.5 transition-all flex-shrink-0" />
                </button>

                {/* Option 3: Spread & Risk Filter Protocol Indicator */}
                <div className="p-2.5 rounded-xl bg-neutral-900/50 border border-neutral-850 text-neutral-300 flex items-start gap-3">
                  <div className="p-2 rounded-lg bg-neutral-900 border border-neutral-800 text-purple-400 flex-shrink-0">
                    <ShieldCheck size={16} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center justify-between">
                      <span className="font-semibold text-neutral-200 text-xs">Spread & R:R Protocol</span>
                      <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-purple-950/60 text-purple-300 border border-purple-800/40">
                        ACTIVE
                      </span>
                    </div>
                    <div className="text-[10px] text-neutral-400 mt-1 leading-relaxed">
                      1.85:1 Min R:R + Broker Spread Buffer & Multi-TF Trend Locks.
                    </div>
                  </div>
                </div>
              </div>

              {/* Status Footer in Hamburger Menu */}
              <div className="mt-2 pt-2 border-t border-neutral-850 px-2 flex items-center justify-between text-[10px] font-mono text-neutral-500">
                <span>MT5 Connection:</span>
                <span className={mt5Connected ? "text-emerald-400 font-semibold flex items-center gap-1" : "text-amber-400/90 font-semibold flex items-center gap-1"}>
                  <span className={`w-1.5 h-1.5 rounded-full ${mt5Connected ? 'bg-emerald-400' : 'bg-amber-400'}`}></span>
                  {mt5Connected ? "LINKED & ONLINE" : "WAITING EA CLIENT"}
                </span>
              </div>
            </div>
          )}
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
          <div className="grid grid-cols-2 md:grid-cols-3 gap-4 lg:gap-6 w-full">
            {PAIRS.map(pair => {
              const pStats = stats[pair] || { won: 0, lost: 0 };
              const total = pStats.won + pStats.lost;
              const winRate = total > 0 ? Math.round((pStats.won / total) * 100) : 0;
              return (
                <div key={pair} className="flex items-center gap-3 bg-neutral-900/50 rounded-xl p-3 border border-neutral-800/50">
                  <div className="w-3 h-3 rounded-full flex-shrink-0" style={{ backgroundColor: COLORS[pair] }} />
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between">
                      <span className="text-sm font-bold text-neutral-200 truncate">{pair}</span>
                      <span className={`text-[9px] font-mono font-bold px-1 rounded border ${PAIR_INFO[pair]?.tagColor || 'text-neutral-400 bg-neutral-900 border-neutral-800'}`}>
                        {PAIR_INFO[pair]?.badge || 'ASSET'}
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

      {/* Bottom 65% - List of Pairs */}
      <div className="flex-1 w-full max-w-7xl mx-auto bg-neutral-950 p-4 lg:p-8">
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-lg font-bold text-neutral-300">Quantitative Algo Watchlist</h2>
          <span className="text-xs font-mono text-neutral-500">6 Verified Low-Spread Assets</span>
        </div>
        <div className="grid gap-3">
          {PAIRS.map(pair => {
             const pStats = stats[pair] || { won: 0, lost: 0 };
             const total = pStats.won + pStats.lost;
             const winRate = total > 0 ? Math.round((pStats.won / total) * 100) : 0;
             const price = prices[pair] || 0;
             const info = PAIR_INFO[pair];
             
             return (
               <div 
                 key={pair} 
                 onClick={() => onSelectPair(pair)}
                 className="group flex flex-col sm:flex-row sm:items-center justify-between p-4 lg:p-5 rounded-2xl bg-neutral-900/60 border border-neutral-800 hover:border-blue-500/50 cursor-pointer transition-all hover:bg-neutral-850 hover:shadow-[0_8px_30px_rgba(59,130,246,0.1)]"
               >
                 <div className="flex items-center gap-4 mb-4 sm:mb-0">
                   <div className="w-12 h-12 rounded-2xl flex items-center justify-center font-bold text-xs font-mono shadow-inner flex-shrink-0" style={{ backgroundColor: `${COLORS[pair]}15`, color: COLORS[pair], border: `1px solid ${COLORS[pair]}40` }}>
                     {pair.replace('USD', '')}
                   </div>
                   <div>
                     <div className="flex items-center gap-2">
                       <span className="text-xl font-bold tracking-tight">{pair}</span>
                       <span className={`text-[10px] font-mono px-2 py-0.5 rounded-full font-bold border ${info?.tagColor || 'text-neutral-400 bg-neutral-900 border-neutral-800'}`}>
                         {info?.badge || 'ASSET'}
                       </span>
                       {pStats.active > 0 && (
                         <div className="relative flex h-2.5 w-2.5" title="Active Trade Running">
                           <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                           <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                         </div>
                       )}
                     </div>
                     <div className="text-xs text-neutral-400 mt-0.5">{info?.label || 'Quantitative Algorithmic Trading'}</div>
                   </div>
                 </div>
                 
                 <div className="flex items-center justify-between sm:justify-end sm:gap-12 w-full sm:w-auto border-t sm:border-t-0 border-neutral-800/50 pt-4 sm:pt-0">
                   <div className="text-right">
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
                   
                   <div className="text-right min-w-[130px]">
                     <div className="text-xs text-neutral-500 mb-0.5">Market Price</div>
                     <div className="font-mono text-xl font-bold text-neutral-100">
                       {price > 0 ? (price < 5 ? `$${price.toFixed(4)}` : `$${price.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`) : '...'}
                     </div>
                   </div>
                 </div>
               </div>
             );
          })}
        </div>
      </div>
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
