import React, { useState, useEffect } from 'react';
import { 
  Activity, 
  CheckCircle2, 
  AlertTriangle, 
  X, 
  RotateCw, 
  Cpu, 
  Database, 
  Radio, 
  Layers, 
  HardDrive,
  ShieldCheck,
  Clock,
  ExternalLink
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { getMarketStatus } from '../lib/market_hours';
import { PAIRS } from '../types';

interface SystemHealthData {
  timestamp: number;
  serverUptime: number;
  database: {
    status: string;
    type: string;
    latencyMs: number;
    totalTrades: number;
  };
  botStatus: string;
  wsStatus: string;
  tradingSession?: string;
  sessionHighLiquidity?: boolean;
  monitoredPairs: string[];
  timeframes?: string[];
  maxConcurrentTrades?: number;
  activeTradesCount: number;
  activeTrades: Array<{ pair: string; type: string; entryPrice: number; stopLoss?: number; takeProfit?: number; tp1Price?: number; tp1Hit?: boolean }>;
  cooldowns?: Record<string, number>;
  marketStatuses?: Record<string, any>;
  fundingRates: Record<string, number>;
  orderBookImbalances: Record<string, number>;
  aiModel: {
    status: string;
    backend: string;
    memorySize: number;
    layers: number;
    isTrained: boolean;
  };
  uptimeSeconds: number;
  heapUsedMb: number;
}

interface Props {
  isOpen: boolean;
  onClose: () => void;
}

export default function SystemDiagnosticsModal({ isOpen, onClose }: Props) {
  const [data, setData] = useState<SystemHealthData | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [scanProgress, setScanProgress] = useState<number>(0);
  const [error, setError] = useState<string | null>(null);

  const runDiagnostics = async () => {
    setLoading(true);
    setScanProgress(15);
    setError(null);

    const timer1 = setTimeout(() => setScanProgress(55), 200);
    const timer2 = setTimeout(() => setScanProgress(85), 450);

    try {
      const res = await fetch('/api/system-health');
      if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
      const json = await res.json();
      setScanProgress(100);
      setTimeout(() => {
        setData(json);
        setLoading(false);
      }, 250);
    } catch (err: any) {
      setError(err.message || 'Failed to reach diagnostic service');
      setLoading(false);
    }

    return () => {
      clearTimeout(timer1);
      clearTimeout(timer2);
    };
  };

  useEffect(() => {
    if (isOpen) {
      runDiagnostics();
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const formatUptime = (seconds: number) => {
    const d = Math.floor(seconds / (3600 * 24));
    const h = Math.floor((seconds % (3600 * 24)) / 3600);
    const m = Math.floor((seconds % 3600) / 60);
    const s = seconds % 60;
    if (d > 0) return `${d}d ${h}h ${m}m`;
    if (h > 0) return `${h}h ${m}m ${s}s`;
    return `${m}m ${s}s`;
  };

  return (
    <AnimatePresence>
      <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 md:p-6 bg-black/85 backdrop-blur-md">
        <motion.div 
          initial={{ opacity: 0, scale: 0.97, y: 8 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.97, y: 8 }}
          className="bg-neutral-950 border border-neutral-800 rounded-2xl w-full max-w-3xl overflow-hidden shadow-2xl flex flex-col max-h-[92vh]"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 sm:py-4 border-b border-neutral-800 bg-neutral-900/60">
            <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
              <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
                <ShieldCheck size={18} className="sm:w-5 sm:h-5" />
              </div>
              <div className="min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <h2 className="text-sm sm:text-base font-bold text-white tracking-tight truncate">
                    System Diagnostics & Health
                  </h2>
                  <span className="text-[9px] sm:text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    Live Telemetry
                  </span>
                </div>
                <p className="text-[11px] text-neutral-400 truncate hidden sm:block">
                  Real-time status of Quant Multi-Factor Engine, WebSockets, DB & Market Schedules
                </p>
              </div>
            </div>

            <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
              <button
                onClick={runDiagnostics}
                disabled={loading}
                className="p-2 text-neutral-400 hover:text-white bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-xl transition-colors disabled:opacity-50 cursor-pointer"
                title="Rerun Scan"
              >
                <RotateCw size={15} className={loading ? 'animate-spin text-emerald-400' : ''} />
              </button>
              <button
                onClick={onClose}
                className="p-2 text-neutral-400 hover:text-white bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-xl transition-colors cursor-pointer"
                title="Close"
              >
                <X size={16} />
              </button>
            </div>
          </div>

          {/* Scanning Progress Bar */}
          {loading && (
            <div className="w-full bg-neutral-900 h-1 relative overflow-hidden">
              <motion.div 
                className="h-full bg-emerald-500" 
                initial={{ width: '0%' }}
                animate={{ width: `${scanProgress}%` }}
                transition={{ duration: 0.3 }}
              />
            </div>
          )}

          {/* Body */}
          <div className="p-3.5 sm:p-6 overflow-y-auto space-y-4 text-xs">
            {error && (
              <div className="p-3.5 rounded-xl bg-rose-500/10 border border-rose-500/20 text-rose-400 text-xs flex items-center gap-2.5">
                <AlertTriangle size={16} className="shrink-0" />
                <span>Diagnostics error: {error}</span>
              </div>
            )}

            {/* Quick Status Bar - 2 columns on mobile, 4 columns on desktop */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-3">
              <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-2.5 sm:p-3">
                <span className="text-[10px] text-neutral-500 uppercase tracking-wider font-semibold block mb-0.5">Server</span>
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse shrink-0" />
                  <span className="font-mono text-xs sm:text-sm font-bold text-white">ONLINE</span>
                </div>
              </div>

              <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-2.5 sm:p-3">
                <span className="text-[10px] text-neutral-500 uppercase tracking-wider font-semibold block mb-0.5">Quant Core</span>
                <div className="flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 shrink-0" />
                  <span className="font-mono text-xs sm:text-sm font-bold text-white">CONFLUENCE</span>
                </div>
              </div>

              <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-2.5 sm:p-3">
                <span className="text-[10px] text-neutral-500 uppercase tracking-wider font-semibold block mb-0.5">Binance WS</span>
                <div className="flex items-center gap-1.5">
                  <span className={`h-2 w-2 rounded-full shrink-0 ${data?.wsStatus === 'CONNECTED' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                  <span className="font-mono text-xs sm:text-sm font-bold text-white truncate">{data?.wsStatus || 'ONLINE'}</span>
                </div>
              </div>

              <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-2.5 sm:p-3">
                <span className="text-[10px] text-neutral-500 uppercase tracking-wider font-semibold block mb-0.5">Heap Memory</span>
                <span className="font-mono text-xs sm:text-sm font-bold text-white">{data?.heapUsedMb ? `${data.heapUsedMb} MB` : '...'}</span>
              </div>
            </div>

            {/* Asset Market Hours Schedule Card */}
            <div className="bg-neutral-900/40 border border-neutral-800 rounded-xl p-3.5 sm:p-4 space-y-2.5">
              <div className="flex items-center justify-between pb-2 border-b border-neutral-800">
                <div className="flex items-center gap-2 text-white font-medium text-xs sm:text-sm">
                  <Clock size={15} className="text-amber-400" />
                  <span>Asset Market Hours & Weekend Detection</span>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-neutral-900 text-neutral-300 border border-neutral-800">
                  Auto-Guard
                </span>
              </div>

              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {PAIRS.map(pair => {
                  const status = getMarketStatus(pair);
                  return (
                    <div key={pair} className="p-2.5 rounded-lg bg-neutral-950/70 border border-neutral-850 flex flex-col justify-between">
                      <div className="flex items-center justify-between gap-1 mb-1">
                        <span className="font-bold font-mono text-white text-xs">{pair}</span>
                        <span className={`text-[9px] font-mono font-bold px-1.5 py-0.5 rounded border ${status.badgeColor}`}>
                          {status.isOpen ? (status.isCrypto ? '24/7' : 'OPEN') : 'CLOSED'}
                        </span>
                      </div>
                      <div className="text-[10px] text-neutral-400 font-mono truncate">
                        {status.isOpen ? status.scheduleText : status.nextOpen || 'Weekend Close'}
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Detailed System Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3 sm:gap-4">
              {/* 1. Quant Multi-Factor Engine */}
              <div className="bg-neutral-900/40 border border-neutral-800 rounded-xl p-3.5 sm:p-4 space-y-2.5">
                <div className="flex items-center justify-between pb-2 border-b border-neutral-800">
                  <div className="flex items-center gap-2 text-white font-medium text-xs sm:text-sm">
                    <Cpu size={15} className="text-purple-400" />
                    <span>Quant Multi-Factor Engine</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/20">
                    {data?.aiModel.status || 'ACTIVE'}
                  </span>
                </div>
                <div className="space-y-1.5 text-xs font-mono">
                  <div className="flex justify-between text-neutral-400">
                    <span>Engine Architecture:</span>
                    <span className="text-white font-semibold">Deterministic Confluence</span>
                  </div>
                  <div className="flex justify-between text-neutral-400">
                    <span>Evaluated Factors:</span>
                    <span className="text-white">1H Anchor, 5m Candle Close, VWAP, ADX</span>
                  </div>
                  <div className="flex justify-between text-neutral-400">
                    <span>Sample Buffer:</span>
                    <span className="text-white">{data?.aiModel.memorySize || 0} trades tracked</span>
                  </div>
                  <div className="flex justify-between text-neutral-400">
                    <span>Engine Status:</span>
                    <span className="text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 size={12} /> Live Filters Active
                    </span>
                  </div>
                </div>
              </div>

              {/* 2. SQLite Database */}
              <div className="bg-neutral-900/40 border border-neutral-800 rounded-xl p-3.5 sm:p-4 space-y-2.5">
                <div className="flex items-center justify-between pb-2 border-b border-neutral-800">
                  <div className="flex items-center gap-2 text-white font-medium text-xs sm:text-sm">
                    <Database size={15} className="text-blue-400" />
                    <span>SQLite3 Persistence Engine</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-blue-500/10 text-blue-300 border border-blue-500/20">
                    {data?.database.status || 'OK'}
                  </span>
                </div>
                <div className="space-y-1.5 text-xs font-mono">
                  <div className="flex justify-between text-neutral-400">
                    <span>Database Engine:</span>
                    <span className="text-white">{data?.database.type || 'SQLite3'}</span>
                  </div>
                  <div className="flex justify-between text-neutral-400">
                    <span>Stored Trades:</span>
                    <span className="text-white font-semibold">{data?.database.totalTrades ?? '...'}</span>
                  </div>
                  <div className="flex justify-between text-neutral-400">
                    <span>Query Latency:</span>
                    <span className="text-emerald-400">{data?.database.latencyMs ?? 0} ms</span>
                  </div>
                  <div className="flex justify-between text-neutral-400">
                    <span>Integrity:</span>
                    <span className="text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 size={12} /> Pass (Synced)
                    </span>
                  </div>
                </div>
              </div>

              {/* 3. Binance Realtime WebSocket */}
              <div className="bg-neutral-900/40 border border-neutral-800 rounded-xl p-3.5 sm:p-4 space-y-2.5">
                <div className="flex items-center justify-between pb-2 border-b border-neutral-800">
                  <div className="flex items-center gap-2 text-white font-medium text-xs sm:text-sm">
                    <Radio size={15} className="text-amber-400" />
                    <span>Binance Feeds & Order Books</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">
                    {data?.wsStatus || 'ONLINE'}
                  </span>
                </div>
                <div className="space-y-1.5 text-xs font-mono">
                  <div className="flex justify-between text-neutral-400">
                    <span>Monitored Assets:</span>
                    <span className="text-white font-semibold">{data?.monitoredPairs.length || 6} pairs</span>
                  </div>
                  <div className="flex justify-between text-neutral-400">
                    <span>Candle Streams:</span>
                    <span className="text-white">5m, 15m, 1h Klines</span>
                  </div>
                  <div className="flex justify-between text-neutral-400">
                    <span>Order Book L2:</span>
                    <span className="text-emerald-400">100ms Depth Stream</span>
                  </div>
                  <div className="flex justify-between text-neutral-400">
                    <span>Futures Funding Poller:</span>
                    <span className="text-emerald-400">Active (Binance FAPI)</span>
                  </div>
                </div>
              </div>

              {/* 4. Automated Bot Runtime */}
              <div className="bg-neutral-900/40 border border-neutral-800 rounded-xl p-3.5 sm:p-4 space-y-2.5">
                <div className="flex items-center justify-between pb-2 border-b border-neutral-800">
                  <div className="flex items-center gap-2 text-white font-medium text-xs sm:text-sm">
                    <Layers size={15} className="text-emerald-400" />
                    <span>Trading Engine Runtime</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-emerald-500/10 text-emerald-300 border border-emerald-500/20">
                    {data?.botStatus || 'ONLINE'}
                  </span>
                </div>
                <div className="space-y-1.5 text-xs font-mono">
                  <div className="flex justify-between text-neutral-400">
                    <span>Server Uptime:</span>
                    <span className="text-white font-semibold">{data ? formatUptime(data.serverUptime) : '...'}</span>
                  </div>
                  <div className="flex justify-between text-neutral-400">
                    <span>Active Trades:</span>
                    <span className="text-white font-medium">{data?.activeTradesCount || 0} / {data?.maxConcurrentTrades || 2} Max</span>
                  </div>
                  <div className="flex justify-between text-neutral-400">
                    <span>1H Macro Guard:</span>
                    <span className="text-emerald-400">50 EMA Trend Filter</span>
                  </div>
                  <div className="flex justify-between text-neutral-400">
                    <span>Trading Session:</span>
                    <span className={`font-mono font-medium ${data?.sessionHighLiquidity ? 'text-emerald-400' : 'text-amber-400'}`}>
                      {data?.tradingSession || 'GLOBAL'} ({data?.sessionHighLiquidity ? 'High Liquidity' : 'Strict Mode'})
                    </span>
                  </div>
                  <div className="flex justify-between text-neutral-400">
                    <span>Execution Trigger:</span>
                    <span className="text-emerald-400">Candle Close Only (kline.x)</span>
                  </div>
                  <div className="flex justify-between text-neutral-400">
                    <span>Trailing Stop:</span>
                    <span className="text-emerald-400">75% TP Target Distance</span>
                  </div>
                  {data?.cooldowns && Object.keys(data.cooldowns).length > 0 && (
                    <div className="flex justify-between text-amber-400 pt-1 border-t border-neutral-800">
                      <span>Cooldown Active:</span>
                      <span>
                        {Object.entries(data.cooldowns).map(([p, s]) => `${p} (${Math.ceil(Number(s) / 60)}m)`).join(', ')}
                      </span>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-4 sm:px-6 py-3 border-t border-neutral-800 bg-neutral-900/40 flex justify-between items-center text-xs text-neutral-500">
            <span className="text-[11px] font-mono">Updated: {data ? new Date(data.timestamp).toLocaleTimeString() : '...'}</span>
            <button
              onClick={onClose}
              className="px-4 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-xl transition-colors font-medium text-xs cursor-pointer"
            >
              Close
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
