import React, { useEffect, useState, useMemo, useRef } from 'react';
import { Activity, Menu, Server, ChevronRight, X } from 'lucide-react';
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
  'BTCUSDT': '#F7931A',
  'ETHUSDT': '#627EEA',
  'SOLUSDT': '#14F195',
  'BNBUSDT': '#F3BA2F',
  'XRPUSDT': '#1E88E5',
  'DOGEUSDT': '#C2A633'
};

const PAIRS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'BNBUSDT', 'XRPUSDT', 'DOGEUSDT'];

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
            if (PAIRS.includes(d.symbol)) {
              priceMap[d.symbol] = parseFloat(d.price);
            }
          });
          setPrices(priceMap);
        }
      } catch (e) {}
    };
    fetchPrices();

    const streams = PAIRS.map(p => `${p.toLowerCase()}@ticker`).join('/');
    const ws = new WebSocket(`wss://stream.binance.com:9443/stream?streams=${streams}`);
    
    ws.onmessage = (event) => {
      try {
        const payload = JSON.parse(event.data);
        if (payload.data && payload.data.s && payload.data.c) {
          const symbol = payload.data.s;
          const price = parseFloat(payload.data.c);
          if (PAIRS.includes(symbol)) {
            setPrices(prev => ({ ...prev, [symbol]: price }));
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
      {/* Top 35% - Statistics */}
      <div className="w-full border-b border-neutral-900 flex flex-col lg:flex-row items-center p-4 lg:p-8 bg-neutral-950/80 backdrop-blur-xl shadow-lg z-10 relative">
        {/* Top-Right Hamburger Menu (replaces old System Diagnostics button) */}
        <div className="absolute top-4 right-4 z-30" ref={menuRef}>
          <button
            onClick={() => setShowMenu(prev => !prev)}
            className="flex items-center justify-center p-2.5 rounded-xl bg-neutral-900/90 hover:bg-neutral-800 border border-neutral-800 hover:border-neutral-700 text-neutral-300 hover:text-white transition-all shadow-lg group backdrop-blur-md cursor-pointer relative"
            title="Glavni Meni Sistema"
          >
            <span className="relative flex h-2 w-2 absolute top-2 right-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            {showMenu ? <X size={20} className="text-white" /> : <Menu size={20} className="text-neutral-300 group-hover:text-white transition-colors" />}
          </button>

          {/* Hamburger Dropdown Menu */}
          {showMenu && (
            <div className="absolute right-0 mt-2 w-64 bg-neutral-950 border border-neutral-800 rounded-2xl shadow-2xl p-2 text-xs backdrop-blur-xl z-50 animate-in fade-in slide-in-from-top-2 duration-150">
              <div className="px-3 py-2 border-b border-neutral-850 text-neutral-500 font-mono text-[10px] uppercase tracking-wider flex items-center justify-between">
                <span>System Menu</span>
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-400"></span>
              </div>

              <div className="py-1 space-y-1">
                {/* Option 1: System Diagnostics */}
                <button
                  onClick={() => {
                    setShowMenu(false);
                    setShowDiagnostics(true);
                  }}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-neutral-200 hover:text-white hover:bg-neutral-900/80 transition-colors group cursor-pointer"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="p-1.5 rounded-lg bg-neutral-900 border border-neutral-800 group-hover:border-emerald-500/30 text-emerald-400">
                      <Activity size={15} />
                    </div>
                    <div className="text-left">
                      <div className="font-semibold text-neutral-200 group-hover:text-white">System Diagnostics</div>
                      <div className="text-[10px] text-neutral-500">Nadzor rada bota i AI modela</div>
                    </div>
                  </div>
                  <ChevronRight size={14} className="text-neutral-600 group-hover:text-neutral-400" />
                </button>

                {/* Option 2: MT5 System Bridge */}
                <button
                  onClick={() => {
                    setShowMenu(false);
                    setShowMT5Bridge(true);
                  }}
                  className="w-full flex items-center justify-between px-3 py-2.5 rounded-xl text-neutral-200 hover:text-white hover:bg-neutral-900/80 transition-colors group cursor-pointer"
                >
                  <div className="flex items-center gap-2.5">
                    <div className="p-1.5 rounded-lg bg-neutral-900 border border-neutral-800 group-hover:border-blue-500/30 text-blue-400">
                      <Server size={15} />
                    </div>
                    <div className="text-left">
                      <div className="flex items-center gap-1.5">
                        <span className="font-semibold text-neutral-200 group-hover:text-white">MT5 System (Bridge)</span>
                        <span className={`h-1.5 w-1.5 rounded-full ${mt5Connected ? 'bg-emerald-400' : 'bg-neutral-600'}`}></span>
                      </div>
                      <div className="text-[10px] text-neutral-500">Podešavanje lota i MQL5 EA</div>
                    </div>
                  </div>
                  <ChevronRight size={14} className="text-neutral-600 group-hover:text-neutral-400" />
                </button>
              </div>

              <div className="p-2 mt-1 border-t border-neutral-900 bg-neutral-900/30 rounded-xl">
                <div className="flex items-center justify-between text-[10px] text-neutral-500 font-mono">
                  <span>MT5 Terminal:</span>
                  <span className={mt5Connected ? "text-emerald-400 font-semibold" : "text-neutral-500"}>
                    {mt5Connected ? "ONLINE" : "WAITING EA"}
                  </span>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Left Side: Donut Chart with Total Wins / Losses (e.g. 20 / 10) & Win Rate % */}
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

          {/* Center Text: 20 / 10 and Win Rate % */}
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
            <span className="text-[9px] text-neutral-500 font-mono mt-0.5">({totalTradesCount} ukupno)</span>
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
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: COLORS[pair] }} />
                  <div className="flex-1">
                    <div className="text-sm font-bold text-neutral-200">{pair}</div>
                    <div className="text-xs text-neutral-500">
                      W: <span className="text-emerald-400">{pStats.won}</span> / 
                      L: <span className="text-rose-400">{pStats.lost}</span> 
                      <span className="ml-2 font-mono">{total > 0 ? `${winRate}%` : '--%'}</span>
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
        <h2 className="text-lg font-bold mb-4 text-neutral-400">Market Pairs</h2>
        <div className="grid gap-3">
          {PAIRS.map(pair => {
             const pStats = stats[pair] || { won: 0, lost: 0 };
             const total = pStats.won + pStats.lost;
             const winRate = total > 0 ? Math.round((pStats.won / total) * 100) : 0;
             const price = prices[pair] || 0;
             
             return (
               <div 
                 key={pair} 
                 onClick={() => onSelectPair(pair)}
                 className="group flex flex-col sm:flex-row sm:items-center justify-between p-4 lg:p-5 rounded-2xl bg-neutral-900/60 border border-neutral-800 hover:border-blue-500/50 cursor-pointer transition-all hover:bg-neutral-800 hover:shadow-[0_8px_30px_rgba(59,130,246,0.1)]"
               >
                 <div className="flex items-center gap-4 mb-4 sm:mb-0">
                   <div className="w-12 h-12 rounded-full flex items-center justify-center font-bold text-sm shadow-inner" style={{ backgroundColor: `${COLORS[pair]}15`, color: COLORS[pair], border: `1px solid ${COLORS[pair]}40` }}>
                     {pair.replace('USDT', '')}
                   </div>
                   <div>
                     <div className="flex items-center gap-2">
                       <div className="text-xl font-bold tracking-tight">{pair}</div>
                       {pStats.active > 0 && (
                         <div className="relative flex h-2.5 w-2.5" title="Active Trade Running">
                           <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                           <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                         </div>
                       )}
                     </div>
                     <div className="text-sm text-neutral-500">Quantitative Algorithmic Trading</div>
                   </div>
                 </div>
                 
                 <div className="flex items-center justify-between sm:justify-end sm:gap-12 w-full sm:w-auto border-t sm:border-t-0 border-neutral-800/50 pt-4 sm:pt-0">
                   <div className="text-right">
                     <div className="text-sm text-neutral-500 mb-1">Win Rate</div>
                     <div className="font-mono flex items-center gap-2">
                       <span className="text-emerald-400 font-bold">{pStats.won}W</span>
                       <span className="text-neutral-600">-</span>
                       <span className="text-rose-400 font-bold">{pStats.lost}L</span>
                       <span className="bg-neutral-950 px-2 py-0.5 rounded text-xs ml-2 border border-neutral-800">
                         {total > 0 ? `${winRate}%` : '--%'}
                       </span>
                     </div>
                   </div>
                   
                   <div className="text-right min-w-[120px]">
                     <div className="text-sm text-neutral-500 mb-1">Market Price</div>
                     <div className="font-mono text-xl font-bold">
                       ${price > 0 ? (price < 10 ? price.toFixed(4) : price.toFixed(2)) : '...'}
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
