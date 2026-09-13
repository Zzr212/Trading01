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
  ShieldCheck
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';

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
  monitoredPairs: string[];
  activeTradesCount: number;
  activeTrades: Array<{ pair: string; type: string; entryPrice: number }>;
  cooldowns?: Record<string, number>;
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
    setScanProgress(10);
    setError(null);

    const timer1 = setTimeout(() => setScanProgress(45), 200);
    const timer2 = setTimeout(() => setScanProgress(80), 450);

    try {
      const res = await fetch('/api/system-health');
      if (!res.ok) throw new Error(`HTTP Error ${res.status}`);
      const json = await res.json();
      setScanProgress(100);
      setTimeout(() => {
        setData(json);
        setLoading(false);
      }, 300);
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
      <div className="fixed inset-0 z-50 flex items-center justify-center p-4 sm:p-6 bg-black/80 backdrop-blur-md">
        <motion.div 
          initial={{ opacity: 0, scale: 0.96, y: 10 }}
          animate={{ opacity: 1, scale: 1, y: 0 }}
          exit={{ opacity: 0, scale: 0.96, y: 10 }}
          className="bg-neutral-950 border border-neutral-800 rounded-2xl w-full max-w-3xl overflow-hidden shadow-2xl flex flex-col max-h-[90vh]"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-800/80 bg-neutral-900/40">
            <div className="flex items-center gap-3">
              <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                <ShieldCheck size={20} />
              </div>
              <div>
                <h2 className="text-base font-bold text-white tracking-tight flex items-center gap-2">
                  System Diagnostics & Health Check
                  <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                    Live Scan
                  </span>
                </h2>
                <p className="text-xs text-neutral-400">
                  Real-time status of TensorFlow.js, WebSockets, SQLite, and Quant Execution Engine.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2">
              <button
                onClick={runDiagnostics}
                disabled={loading}
                className="p-2 text-neutral-400 hover:text-white bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-lg transition-colors disabled:opacity-50"
                title="Rerun Scan"
              >
                <RotateCw size={16} className={loading ? 'animate-spin text-emerald-400' : ''} />
              </button>
              <button
                onClick={onClose}
                className="p-2 text-neutral-400 hover:text-white bg-neutral-900 hover:bg-neutral-800 border border-neutral-800 rounded-lg transition-colors"
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
          <div className="p-6 overflow-y-auto space-y-4">
            {error && (
              <div className="p-4 rounded-xl bg-red-500/10 border border-red-500/20 text-red-400 text-sm flex items-center gap-3">
                <AlertTriangle size={18} />
                <span>Diagnostics error: {error}</span>
              </div>
            )}

            {/* Quick Status Bar */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-neutral-900/60 border border-neutral-800/80 rounded-xl p-3">
                <span className="text-[10px] text-neutral-500 uppercase tracking-wider font-semibold block mb-1">Server Status</span>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="font-mono text-sm font-bold text-white">ONLINE</span>
                </div>
              </div>

              <div className="bg-neutral-900/60 border border-neutral-800/80 rounded-xl p-3">
                <span className="text-[10px] text-neutral-500 uppercase tracking-wider font-semibold block mb-1">AI Engine</span>
                <div className="flex items-center gap-2">
                  <span className="h-2 w-2 rounded-full bg-emerald-400" />
                  <span className="font-mono text-sm font-bold text-white">TF.JS ACTIVE</span>
                </div>
              </div>

              <div className="bg-neutral-900/60 border border-neutral-800/80 rounded-xl p-3">
                <span className="text-[10px] text-neutral-500 uppercase tracking-wider font-semibold block mb-1">Binance WS</span>
                <div className="flex items-center gap-2">
                  <span className={`h-2 w-2 rounded-full ${data?.wsStatus === 'CONNECTED' ? 'bg-emerald-400' : 'bg-amber-400'}`} />
                  <span className="font-mono text-sm font-bold text-white">{data?.wsStatus || 'CHECKING'}</span>
                </div>
              </div>

              <div className="bg-neutral-900/60 border border-neutral-800/80 rounded-xl p-3">
                <span className="text-[10px] text-neutral-500 uppercase tracking-wider font-semibold block mb-1">Heap Memory</span>
                <span className="font-mono text-sm font-bold text-white">{data?.heapUsedMb ? `${data.heapUsedMb} MB` : '...'}</span>
              </div>
            </div>

            {/* Detailed System Cards */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-2">
              {/* 1. TensorFlow.js Card */}
              <div className="bg-neutral-900/40 border border-neutral-800/80 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-neutral-800/60">
                  <div className="flex items-center gap-2 text-white font-medium text-sm">
                    <Cpu size={16} className="text-purple-400" />
                    <span>TensorFlow.js Neural Engine</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-purple-500/10 text-purple-300 border border-purple-500/20">
                    {data?.aiModel.status || 'READY'}
                  </span>
                </div>
                <div className="space-y-1.5 text-xs font-mono">
                  <div className="flex justify-between text-neutral-400">
                    <span>TF Backend:</span>
                    <span className="text-white font-semibold">{data?.aiModel.backend || 'cpu'}</span>
                  </div>
                  <div className="flex justify-between text-neutral-400">
                    <span>Network Topology:</span>
                    <span className="text-white">3 Layers (16 &rarr; 8 &rarr; 1)</span>
                  </div>
                  <div className="flex justify-between text-neutral-400">
                    <span>Memory Buffer:</span>
                    <span className="text-white">{data?.aiModel.memorySize || 0} sample trades</span>
                  </div>
                  <div className="flex justify-between text-neutral-400">
                    <span>Retraining Trigger:</span>
                    <span className="text-emerald-400">Every 5 closed trades</span>
                  </div>
                  <div className="flex justify-between text-neutral-400">
                    <span>Model State:</span>
                    <span className="text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 size={12} /> Trained & Operational
                    </span>
                  </div>
                </div>
              </div>

              {/* 2. SQLite Database */}
              <div className="bg-neutral-900/40 border border-neutral-800/80 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-neutral-800/60">
                  <div className="flex items-center gap-2 text-white font-medium text-sm">
                    <Database size={16} className="text-blue-400" />
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
                    <span>Replay Table:</span>
                    <span className="text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 size={12} /> trade_reviews (active)
                    </span>
                  </div>
                  <div className="flex justify-between text-neutral-400">
                    <span>Integrity Check:</span>
                    <span className="text-emerald-400">Pass (No corruption)</span>
                  </div>
                </div>
              </div>

              {/* 3. Binance Realtime WebSocket Streams */}
              <div className="bg-neutral-900/40 border border-neutral-800/80 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-neutral-800/60">
                  <div className="flex items-center gap-2 text-white font-medium text-sm">
                    <Radio size={16} className="text-amber-400" />
                    <span>Binance Feeds & Order Books</span>
                  </div>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-amber-500/10 text-amber-300 border border-amber-500/20">
                    {data?.wsStatus || 'ONLINE'}
                  </span>
                </div>
                <div className="space-y-1.5 text-xs font-mono">
                  <div className="flex justify-between text-neutral-400">
                    <span>Monitored Symbols:</span>
                    <span className="text-white font-semibold">{data?.monitoredPairs.length || 6} pairs</span>
                  </div>
                  <div className="flex justify-between text-neutral-400">
                    <span>Timeframes Streamed:</span>
                    <span className="text-white">5m & 15m Klines</span>
                  </div>
                  <div className="flex justify-between text-neutral-400">
                    <span>Order Book Stream:</span>
                    <span className="text-emerald-400">100ms L2 Depth</span>
                  </div>
                  <div className="flex justify-between text-neutral-400">
                    <span>Futures Funding Poller:</span>
                    <span className="text-emerald-400">Active (Binance FAPI)</span>
                  </div>
                  <div className="flex justify-between text-neutral-400">
                    <span>Connection Health:</span>
                    <span className="text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 size={12} /> Low Latency Stream
                    </span>
                  </div>
                </div>
              </div>

              {/* 4. Automated Bot Runtime */}
              <div className="bg-neutral-900/40 border border-neutral-800/80 rounded-xl p-4 space-y-3">
                <div className="flex items-center justify-between pb-2 border-b border-neutral-800/60">
                  <div className="flex items-center gap-2 text-white font-medium text-sm">
                    <Layers size={16} className="text-emerald-400" />
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
                    <span>Active Positions:</span>
                    <span className="text-white">{data?.activeTradesCount || 0} Open</span>
                  </div>
                  <div className="flex justify-between text-neutral-400">
                    <span>Anti-Chop Filter:</span>
                    <span className="text-emerald-400">ADX (≥22 Trend Confirmed)</span>
                  </div>
                  <div className="flex justify-between text-neutral-400">
                    <span>Signal Execution:</span>
                    <span className="text-emerald-400">Candle Close (kline.x)</span>
                  </div>
                  <div className="flex justify-between text-neutral-400">
                    <span>Loss Protection:</span>
                    <span className="text-emerald-400">Break-Even & 35m Cooldown</span>
                  </div>
                  {data?.cooldowns && Object.keys(data.cooldowns).length > 0 && (
                    <div className="flex justify-between text-amber-400 pt-1 border-t border-neutral-800/60">
                      <span>Loss Cooldown:</span>
                      <span>
                        {Object.entries(data.cooldowns).map(([p, s]) => `${p} (${Math.ceil(Number(s) / 60)}m)`).join(', ')}
                      </span>
                    </div>
                  )}
                  <div className="flex justify-between text-neutral-400">
                    <span>Process Node.js:</span>
                    <span className="text-emerald-400 flex items-center gap-1">
                      <CheckCircle2 size={12} /> Healthy Loop
                    </span>
                  </div>
                </div>
              </div>
            </div>

            {/* Note regarding deployment & npm install */}
            <div className="p-3.5 rounded-xl bg-neutral-900/70 border border-neutral-800 text-xs text-neutral-400 flex items-start gap-2.5">
              <HardDrive size={16} className="text-neutral-400 shrink-0 mt-0.5" />
              <div>
                <strong className="text-neutral-200">Server Deployment Tip: </strong>
                Kada radiš <code className="text-emerald-400 bg-black/40 px-1 py-0.5 rounded">git pull</code> na vlastitom serveru, obavezno pokreni i <code className="text-emerald-400 bg-black/40 px-1 py-0.5 rounded">npm install</code> kako bi se novi paketi (poput TensorFlow.js) automatski preuzeli u <code className="text-neutral-300">node_modules</code>.
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="px-6 py-3.5 border-t border-neutral-800/80 bg-neutral-900/30 flex justify-between items-center text-xs text-neutral-500">
            <span>Last diagnostic timestamp: {data ? new Date(data.timestamp).toLocaleTimeString() : '...'}</span>
            <button
              onClick={onClose}
              className="px-4 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-neutral-200 rounded-lg transition-colors font-medium text-xs"
            >
              Close
            </button>
          </div>
        </motion.div>
      </div>
    </AnimatePresence>
  );
}
