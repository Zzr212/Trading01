import React, { useState, useEffect } from 'react';
import { 
  X, Check, Copy, Download, RefreshCw, Server, ShieldCheck, 
  AlertCircle, ArrowRight, ExternalLink, Cpu, Sliders, FileCode, CheckCircle2, Save 
} from 'lucide-react';
import { PAIRS } from '../types';
import { generateMql5EACode } from '../mt5_bridge';
import { getMarketStatus } from '../lib/market_hours';

interface MT5Config {
  enabled: boolean;
  serverUrl: string;
  magicNumber: number;
  slippagePoints: number;
  lotSizes: Record<string, number>;
  symbolMappings: Record<string, string>;
}

interface MT5Status {
  connected: boolean;
  lastHeartbeat: number;
  accountNumber: string | null;
  broker: string | null;
  balance: number;
  equity: number;
  margin: number;
  freeMargin: number;
  openPositionsCount: number;
}

interface MT5BridgeModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const MT5BridgeModal: React.FC<MT5BridgeModalProps> = ({ isOpen, onClose }) => {
  const [activeTab, setActiveTab] = useState<'status' | 'lots' | 'code' | 'instructions'>('status');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tunnelUrl, setTunnelUrl] = useState<string>('');
  const [copied, setCopied] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [config, setConfig] = useState<MT5Config>({
    enabled: true,
    serverUrl: typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000',
    magicNumber: 889900,
    slippagePoints: 50,
    lotSizes: {
      "BTCUSD": 0.01,
      "ETHUSD": 0.05,
      "XAUUSD": 0.02,
      "EURUSD": 0.10,
      "GBPUSD": 0.10,
      "SOLUSD": 0.50
    },
    symbolMappings: {
      "BTCUSD": "BTCUSD",
      "ETHUSD": "ETHUSD",
      "XAUUSD": "XAUUSD",
      "EURUSD": "EURUSD",
      "GBPUSD": "GBPUSD",
      "SOLUSD": "SOLUSD"
    }
  });

  const [status, setStatus] = useState<MT5Status>({
    connected: false,
    lastHeartbeat: 0,
    accountNumber: null,
    broker: null,
    balance: 0,
    equity: 0,
    margin: 0,
    freeMargin: 0,
    openPositionsCount: 0
  });

  const initialOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3000';
  const [eaCode, setEaCode] = useState<string>(() => generateMql5EACode(initialOrigin));

  const fetchData = async (isInitial = false, signal?: AbortSignal) => {
    if (isInitial) setLoading(true);
    try {
      const res = await fetch('/api/mt5/config', { signal });
      if (res.ok) {
        const data = await res.json();
        if (data.tunnelUrl) {
          setTunnelUrl(data.tunnelUrl);
        }
        if (data.config) {
          const isCloudRun = typeof window !== 'undefined' && window.location.origin.includes('run.app');
          const isIpOrLocal = typeof window !== 'undefined' && (
            /^(https?:\/\/)?(\d{1,3}\.){3}\d{1,3}(:\d+)?$/.test(window.location.origin) ||
            window.location.hostname === 'localhost' ||
            window.location.hostname.includes('oracle')
          );
          
          let resolvedUrl = data.config.serverUrl || window.location.origin;
          if (resolvedUrl && resolvedUrl.includes('92.5.176.43')) {
            resolvedUrl = 'http://92.5.176.43';
          } else if (isIpOrLocal) {
            resolvedUrl = window.location.origin.includes('92.5.176.43') ? 'http://92.5.176.43' : window.location.origin;
          } else if (data.config.serverUrl && !data.config.serverUrl.includes('trycloudflare')) {
            resolvedUrl = data.config.serverUrl;
          } else if (isCloudRun && data.tunnelUrl) {
            resolvedUrl = data.tunnelUrl;
          } else if (data.tunnelUrl) {
            resolvedUrl = data.tunnelUrl;
          }

          setConfig(prev => ({
            ...prev,
            ...data.config,
            serverUrl: prev.serverUrl && !isInitial ? (prev.serverUrl.includes('92.5.176.43:3000') ? 'http://92.5.176.43' : prev.serverUrl) : resolvedUrl
          }));

          if (isInitial) {
            setEaCode(generateMql5EACode(resolvedUrl));
          }
        }
        if (data.status) {
          setStatus(data.status);
        }
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        // Silently tolerate transient network delays
      }
    } finally {
      if (isInitial) setLoading(false);
    }
  };

  useEffect(() => {
    if (!isOpen) return;

    const controller = new AbortController();
    fetchData(true, controller.signal);

    const interval = setInterval(() => {
      fetchData(false, controller.signal);
    }, 5000);

    return () => {
      controller.abort();
      clearInterval(interval);
    };
  }, [isOpen]);

  const handleSaveConfig = async () => {
    try {
      setSaving(true);
      const res = await fetch('/api/mt5/config', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(config)
      });
      if (res.ok) {
        setSaveSuccess(true);
        setTimeout(() => setSaveSuccess(false), 2500);
      }
    } catch (err) {
      console.error("Save failed:", err);
    } finally {
      setSaving(false);
    }
  };

  const handleCopyCode = () => {
    if (!eaCode) return;
    navigator.clipboard.writeText(eaCode);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadFile = () => {
    if (!eaCode) return;
    const blob = new Blob([eaCode], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'AITrader_MT5_Bridge.mq5';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  if (!isOpen) return null;

  const isRecentlyConnected = status.connected && (Date.now() - status.lastHeartbeat < 25000);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-2 sm:p-4 md:p-6 bg-black/85 backdrop-blur-md">
      <div className="bg-neutral-950 border border-neutral-800 rounded-2xl w-full max-w-4xl overflow-hidden shadow-2xl flex flex-col max-h-[94vh] sm:max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3.5 sm:py-4 border-b border-neutral-800 bg-neutral-900/60">
          <div className="flex items-center gap-2.5 sm:gap-3 min-w-0">
            <div className="p-2 rounded-xl bg-blue-500/10 border border-blue-500/20 text-blue-400 shrink-0">
              <Server size={18} className="sm:w-5 sm:h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-sm sm:text-base font-bold text-white tracking-tight truncate">
                  MetaTrader 5 Bridge Hub
                </h2>
                <span className="text-[9px] sm:text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  Execution Layer
                </span>
              </div>
              <p className="text-[11px] text-neutral-400 truncate hidden sm:block">
                Povezivanje web algoritma sa Vašim Vantage MT5 terminalom
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
            <button
              onClick={() => fetchData(true)}
              className="p-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-neutral-400 hover:text-white border border-neutral-800 transition-colors cursor-pointer"
              title="Osveži podatke"
            >
              <RefreshCw size={15} className={loading ? "animate-spin text-blue-400" : ""} />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-xl bg-neutral-900 hover:bg-neutral-800 text-neutral-400 hover:text-white border border-neutral-800 transition-colors cursor-pointer"
            >
              <X size={16} />
            </button>
          </div>
        </div>

        {/* Live Status Pill & Horizontal Scrollable Tabs */}
        <div className="px-4 sm:px-6 py-2.5 bg-neutral-900/40 border-b border-neutral-850 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          {/* Scrollable tab row on mobile */}
          <div className="flex items-center gap-1.5 overflow-x-auto pb-1 sm:pb-0 no-scrollbar">
            <button
              onClick={() => setActiveTab('status')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap cursor-pointer ${
                activeTab === 'status' 
                  ? 'bg-neutral-800 text-white shadow border border-neutral-700' 
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              Status & Telemetrija
            </button>
            <button
              onClick={() => setActiveTab('lots')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap cursor-pointer ${
                activeTab === 'lots' 
                  ? 'bg-neutral-800 text-white shadow border border-neutral-700' 
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              Lot Veličine & Simboli
            </button>
            <button
              onClick={() => setActiveTab('code')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap cursor-pointer ${
                activeTab === 'code' 
                  ? 'bg-neutral-800 text-white shadow border border-neutral-700' 
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              MQL5 Kod (EA)
            </button>
            <button
              onClick={() => setActiveTab('instructions')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all whitespace-nowrap cursor-pointer ${
                activeTab === 'instructions' 
                  ? 'bg-neutral-800 text-white shadow border border-neutral-700' 
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              Uputstvo za Setup
            </button>
          </div>

          <div className="flex items-center self-start sm:self-auto">
            <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-mono font-medium border ${
              isRecentlyConnected 
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' 
                : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
            }`}>
              <span className={`h-2 w-2 rounded-full shrink-0 ${isRecentlyConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`}></span>
              <span>{isRecentlyConnected ? 'MT5 ONLINE' : 'ČEKAM EA KONEKCIJU'}</span>
            </div>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-4 sm:p-6 overflow-y-auto space-y-4 sm:space-y-6 flex-1 text-xs text-neutral-300">
          
          {/* TAB 1: STATUS */}
          {activeTab === 'status' && (
            <div className="space-y-4 sm:space-y-6 animate-in fade-in duration-150">
              {/* Connection Banner */}
              <div className={`p-3.5 sm:p-4 rounded-xl border flex items-start gap-3 ${
                isRecentlyConnected 
                  ? 'bg-emerald-950/20 border-emerald-800/40 text-emerald-200' 
                  : 'bg-neutral-900/80 border-neutral-800 text-neutral-300'
              }`}>
                <div className={`p-2 rounded-lg mt-0.5 shrink-0 ${isRecentlyConnected ? 'bg-emerald-500/20 text-emerald-400' : 'bg-neutral-800 text-neutral-400'}`}>
                  {isRecentlyConnected ? <ShieldCheck size={18} /> : <AlertCircle size={18} />}
                </div>
                <div>
                  <h3 className="font-semibold text-white text-xs sm:text-sm">
                    {isRecentlyConnected 
                      ? 'MetaTrader 5 je uspešno sinhronizovan!' 
                      : 'Nema aktivne konekcije sa MetaTrader 5 terminalom'}
                  </h3>
                  <p className="text-[11px] text-neutral-400 mt-1 leading-relaxed">
                    {isRecentlyConnected
                      ? `EA na laptopu šalje puls svakih ${Math.max(1, Math.round((Date.now() - status.lastHeartbeat) / 1000))}s. Svi nalozi i pomeranja Stop Loss-a se prenose trenutno.`
                      : 'Ubacite MQL5 kod u MetaEditor na laptopu, unesite URL servera u WebRequest i pokrenite EA na grafikonu.'}
                  </p>
                </div>
              </div>

              {/* Terminal Telemetry Grid - 2 columns on mobile, 4 on desktop */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5 sm:gap-3">
                <div className="bg-neutral-900/60 border border-neutral-800 p-3 rounded-xl">
                  <div className="text-[10px] text-neutral-500 uppercase tracking-wider font-mono">Broker</div>
                  <div className="text-sm sm:text-base font-bold text-white mt-1 truncate">{status.broker || (isRecentlyConnected ? 'Vantage' : 'N/A')}</div>
                  <div className="text-[10px] text-neutral-500 mt-0.5 truncate">Acc: {status.accountNumber || 'N/A'}</div>
                </div>

                <div className="bg-neutral-900/60 border border-neutral-800 p-3 rounded-xl">
                  <div className="text-[10px] text-neutral-500 uppercase tracking-wider font-mono">MT5 Balans</div>
                  <div className="text-sm sm:text-base font-bold text-emerald-400 mt-1 font-mono truncate">
                    ${status.balance ? status.balance.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '0.00'}
                  </div>
                  <div className="text-[10px] text-neutral-500 mt-0.5 truncate">Eq: ${status.equity ? status.equity.toFixed(2) : '0.00'}</div>
                </div>

                <div className="bg-neutral-900/60 border border-neutral-800 p-3 rounded-xl">
                  <div className="text-[10px] text-neutral-500 uppercase tracking-wider font-mono">Slobodna Margina</div>
                  <div className="text-sm sm:text-base font-bold text-white mt-1 font-mono truncate">
                    ${status.freeMargin ? status.freeMargin.toFixed(2) : '0.00'}
                  </div>
                  <div className="text-[10px] text-neutral-500 mt-0.5 truncate">Margina: ${status.margin ? status.margin.toFixed(2) : '0.00'}</div>
                </div>

                <div className="bg-neutral-900/60 border border-neutral-800 p-3 rounded-xl">
                  <div className="text-[10px] text-neutral-500 uppercase tracking-wider font-mono">Aktivne Pozicije</div>
                  <div className="text-sm sm:text-base font-bold text-blue-400 mt-1 font-mono">
                    {status.openPositionsCount}
                  </div>
                  <div className="text-[10px] text-neutral-500 mt-0.5">Magic: {config.magicNumber}</div>
                </div>
              </div>

              {/* Endpoint Information & Server URL */}
              <div className="bg-neutral-900/60 border border-neutral-800 rounded-xl p-3.5 sm:p-4 space-y-3">
                <div className="flex items-center justify-between flex-wrap gap-2">
                  <h4 className="text-xs font-semibold text-neutral-200 uppercase tracking-wider font-mono flex items-center gap-1.5">
                    <Cpu size={14} className="text-blue-400" />
                    Povezivanje Servera (Oracle VPS IP / WebRequest)
                  </h4>
                  {config.serverUrl && !config.serverUrl.includes('run.app') && !config.serverUrl.includes('trycloudflare') ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-mono bg-blue-500/10 text-blue-400 border border-blue-500/30">
                      Oracle VPS IP
                    </span>
                  ) : tunnelUrl ? (
                    <span className="inline-flex items-center px-2 py-0.5 rounded-full text-[10px] font-mono bg-emerald-500/10 text-emerald-400 border border-emerald-500/30">
                      Aktivan Tunel
                    </span>
                  ) : null}
                </div>

                <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2">
                  <input
                    type="text"
                    value={config.serverUrl || ''}
                    onChange={(e) => {
                      const val = e.target.value;
                      setConfig(prev => ({ ...prev, serverUrl: val }));
                      setEaCode(generateMql5EACode(val || window.location.origin));
                    }}
                    placeholder="http://TVOJ_ORACLE_IP:3000"
                    className="flex-1 bg-neutral-950 border border-neutral-750 rounded-xl px-3 py-2 text-xs font-mono text-emerald-400 font-semibold focus:outline-none focus:border-blue-500"
                  />
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleSaveConfig}
                      disabled={saving}
                      className="flex-1 sm:flex-none px-3.5 py-2 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs font-medium transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow"
                    >
                      {saveSuccess ? <Check size={14} className="text-white" /> : <Save size={14} />}
                      <span>{saveSuccess ? 'Sačuvano!' : 'Sačuvaj'}</span>
                    </button>
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(config.serverUrl || window.location.origin);
                        setCopied(true);
                        setTimeout(() => setCopied(false), 2000);
                      }}
                      className="flex-1 sm:flex-none px-3 py-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded-xl text-xs font-medium transition-colors flex items-center justify-center gap-1.5 cursor-pointer"
                    >
                      {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                      <span>{copied ? 'Kopirano' : 'Kopiraj'}</span>
                    </button>
                  </div>
                </div>

                {/* Quick Presets */}
                <div className="flex flex-wrap items-center gap-1.5 pt-1">
                  <button
                    type="button"
                    onClick={() => {
                      const oracleUrl = 'http://92.5.176.43';
                      setConfig(prev => ({ ...prev, serverUrl: oracleUrl }));
                      setEaCode(generateMql5EACode(oracleUrl));
                    }}
                    className="px-2.5 py-1 rounded-lg bg-neutral-800 hover:bg-neutral-750 text-emerald-400 border border-neutral-700 text-[11px] font-mono transition-colors flex items-center gap-1 cursor-pointer"
                  >
                    <span>⚡ Oracle VPS (http://92.5.176.43)</span>
                  </button>
                  {tunnelUrl && (
                    <button
                      type="button"
                      onClick={() => {
                        setConfig(prev => ({ ...prev, serverUrl: tunnelUrl }));
                        setEaCode(generateMql5EACode(tunnelUrl));
                      }}
                      className="px-2.5 py-1 rounded-lg bg-neutral-850 hover:bg-neutral-800 text-neutral-400 border border-neutral-800 text-[11px] font-mono transition-colors flex items-center gap-1 cursor-pointer"
                    >
                      <span>☁️ Cloudflare Tunel</span>
                    </button>
                  )}
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: LOT SIZES - Mobile First Responsive Card Layout */}
          {activeTab === 'lots' && (
            <div className="space-y-4 sm:space-y-6 animate-in fade-in duration-150">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-xs sm:text-sm font-semibold text-white">Konfiguracija lota i MT5 simbola</h3>
                  <p className="text-[11px] text-neutral-400">Podesite željeni lot (Volume) koji će EA otvarati na Vašem računu za svaki par.</p>
                </div>
                <button
                  onClick={handleSaveConfig}
                  disabled={saving}
                  className="self-start sm:self-auto px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-medium rounded-xl transition-colors shadow flex items-center gap-2 cursor-pointer"
                >
                  {saving ? <RefreshCw size={14} className="animate-spin" /> : saveSuccess ? <CheckCircle2 size={14} className="text-emerald-300" /> : <Save size={14} />}
                  <span>{saveSuccess ? 'Sačuvano!' : 'Sačuvaj Podešavanja'}</span>
                </button>
              </div>

              {/* Mobile-Friendly Grid of Cards */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
                {PAIRS.map(pair => {
                  const currentLot = config.lotSizes[pair] ?? (config.lotSizes[`${pair}T`] ?? 0.01);
                  const currentMt5Sym = config.symbolMappings[pair] ?? (config.symbolMappings[`${pair}T`] ?? pair);
                  const marketStatus = getMarketStatus(pair);
                  
                  return (
                    <div key={pair} className="p-3.5 rounded-xl bg-neutral-900/60 border border-neutral-800 flex flex-col justify-between space-y-3">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="font-mono font-bold text-white text-sm">{pair}</span>
                          <span className={`text-[9px] font-mono px-1.5 py-0.5 rounded border ${marketStatus.badgeColor}`}>
                            {marketStatus.isOpen ? (marketStatus.isCrypto ? 'CRYPTO 24/7' : 'OPEN') : 'WEEKEND'}
                          </span>
                        </div>
                        <span className="text-[10px] text-neutral-500 font-mono">
                          Min: {pair === 'BTCUSD' ? '0.01' : pair === 'ETHUSD' ? '0.05' : pair === 'XAUUSD' ? '0.02' : pair === 'SOLUSD' ? '0.50' : '0.10'}
                        </span>
                      </div>

                      <div className="grid grid-cols-2 gap-2">
                        <div>
                          <label className="text-[10px] text-neutral-400 block mb-1">MT5 Simbol</label>
                          <input
                            type="text"
                            value={currentMt5Sym}
                            onChange={(e) => {
                              const val = e.target.value.trim();
                              setConfig(prev => ({
                                ...prev,
                                symbolMappings: {
                                  ...prev.symbolMappings,
                                  [pair]: val
                                }
                              }));
                            }}
                            className="w-full bg-neutral-950 border border-neutral-750 rounded-lg px-2.5 py-1.5 text-xs font-mono text-neutral-200 focus:border-blue-500 focus:outline-none"
                          />
                        </div>

                        <div>
                          <label className="text-[10px] text-neutral-400 block mb-1">Lot Veličina</label>
                          <input
                            type="number"
                            step="0.01"
                            min="0.01"
                            value={currentLot}
                            onChange={(e) => {
                              const val = parseFloat(e.target.value) || 0.01;
                              setConfig(prev => ({
                                ...prev,
                                lotSizes: {
                                  ...prev.lotSizes,
                                  [pair]: val
                                }
                              }));
                            }}
                            className="w-full bg-neutral-950 border border-neutral-750 rounded-lg px-2.5 py-1.5 text-xs font-mono text-emerald-400 font-bold focus:border-blue-500 focus:outline-none"
                          />
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>

              {/* Extra Risk Controls */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3.5 rounded-xl bg-neutral-900/40 border border-neutral-800">
                <div>
                  <label className="text-xs font-medium text-neutral-300 block mb-1">MT5 Magic Number</label>
                  <input
                    type="number"
                    value={config.magicNumber}
                    onChange={(e) => setConfig(prev => ({ ...prev, magicNumber: parseInt(e.target.value) || 889900 }))}
                    className="w-full bg-neutral-950 border border-neutral-750 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none"
                  />
                  <span className="text-[10px] text-neutral-500 mt-0.5 block">Identifikator AI trejdova u terminalu</span>
                </div>
                <div>
                  <label className="text-xs font-medium text-neutral-300 block mb-1">Maksimalni Slippage (u poenima)</label>
                  <input
                    type="number"
                    value={config.slippagePoints}
                    onChange={(e) => setConfig(prev => ({ ...prev, slippagePoints: parseInt(e.target.value) || 50 }))}
                    className="w-full bg-neutral-950 border border-neutral-750 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none"
                  />
                  <span className="text-[10px] text-neutral-500 mt-0.5 block">Maksimalno dozvoljeno cenovno odstupanje</span>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: MQL5 CODE */}
          {activeTab === 'code' && (
            <div className="space-y-3.5 animate-in fade-in duration-150">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
                <div>
                  <h3 className="text-xs sm:text-sm font-semibold text-white">MQL5 Expert Advisor Kod (.mq5)</h3>
                  <p className="text-[11px] text-neutral-400">Izvorni kod za MetaEditor na Vašem laptopu.</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopyCode}
                    className="flex-1 sm:flex-none px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-white rounded-xl text-xs font-medium transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow"
                  >
                    {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                    <span>{copied ? 'Kopirano!' : 'Kopiraj Kod'}</span>
                  </button>
                  <button
                    onClick={handleDownloadFile}
                    className="flex-1 sm:flex-none px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-xl text-xs font-medium transition-colors flex items-center justify-center gap-1.5 cursor-pointer shadow"
                  >
                    <Download size={14} />
                    <span>Preuzmi .mq5</span>
                  </button>
                </div>
              </div>

              {/* Code Display Area */}
              <div className="relative rounded-xl border border-neutral-800 bg-neutral-950 overflow-hidden">
                <div className="flex items-center justify-between px-3.5 py-2 border-b border-neutral-850 bg-neutral-900/60 text-[11px] font-mono text-neutral-400">
                  <div className="flex items-center gap-2">
                    <FileCode size={14} className="text-blue-400" />
                    <span>AITrader_MT5_Bridge.mq5</span>
                  </div>
                  <span>MQL5 UTF-8</span>
                </div>
                <pre className="p-3.5 text-[11px] font-mono text-neutral-300 overflow-x-auto max-h-[340px] leading-relaxed selection:bg-blue-500 selection:text-white">
                  {eaCode || '// Učitavanje koda...'}
                </pre>
              </div>
            </div>
          )}

          {/* TAB 4: INSTRUCTIONS */}
          {activeTab === 'instructions' && (
            <div className="space-y-3.5 sm:space-y-4 animate-in fade-in duration-150 text-xs leading-relaxed">
              <h3 className="text-xs sm:text-sm font-bold text-white">Setup u 4 jednostavna koraka:</h3>

              <div className="space-y-3">
                {/* Step 1 */}
                <div className="flex items-start gap-3 p-3.5 rounded-xl bg-neutral-900/50 border border-neutral-800">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-500/20 text-blue-400 font-bold font-mono text-xs">
                    1
                  </div>
                  <div className="space-y-1.5 min-w-0 flex-1">
                    <h4 className="font-semibold text-white">Dozvola WebRequest u MetaTraderu 5</h4>
                    <p className="text-neutral-400">
                      U MT5 na laptopu otvorite: <code className="text-neutral-200 bg-neutral-950 px-1 py-0.5 rounded border border-neutral-800 font-mono">Tools → Options (Ctrl+O) → Expert Advisors</code>
                    </p>
                    <ul className="list-disc list-inside text-neutral-400 space-y-0.5 pl-1">
                      <li>Označite <strong className="text-neutral-200">"Allow Algo Trading"</strong></li>
                      <li>Označite <strong className="text-neutral-200">"Allow WebRequest for listed URL"</strong></li>
                      <li>Dodajte adresu servera:</li>
                    </ul>
                    <div className="p-2 rounded bg-neutral-950 font-mono text-emerald-400 text-[11px] border border-neutral-800 flex items-center justify-between gap-2 overflow-hidden">
                      <span className="truncate">{config.serverUrl || tunnelUrl || window.location.origin}</span>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(config.serverUrl || tunnelUrl || window.location.origin);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        }}
                        className="text-neutral-400 hover:text-white shrink-0 cursor-pointer"
                        title="Kopiraj"
                      >
                        {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                      </button>
                    </div>
                  </div>
                </div>

                {/* Step 2 */}
                <div className="flex items-start gap-3 p-3.5 rounded-xl bg-neutral-900/50 border border-neutral-800">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-500/20 text-blue-400 font-bold font-mono text-xs">
                    2
                  </div>
                  <div className="space-y-1 min-w-0 flex-1">
                    <h4 className="font-semibold text-white">Kompajliranje u MetaEditoru</h4>
                    <p className="text-neutral-400">
                      Pritisnite <strong className="text-neutral-200">F4</strong> u MT5, kreirajte novi Expert Advisor pod nazivom <span className="font-mono text-blue-300">AITrader_MT5_Bridge</span>, zalepite kod iz taba <em>MQL5 Kod</em> i pritisnite <strong className="text-emerald-400">F7 (Compile)</strong>.
                    </p>
                  </div>
                </div>

                {/* Step 3 */}
                <div className="flex items-start gap-3 p-3.5 rounded-xl bg-neutral-900/50 border border-neutral-800">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-500/20 text-blue-400 font-bold font-mono text-xs">
                    3
                  </div>
                  <div className="space-y-1 min-w-0 flex-1">
                    <h4 className="font-semibold text-white">Pokretanje na grafikonu</h4>
                    <p className="text-neutral-400">
                      U MT5 u levom panelu <em>Navigator</em> pod <em>Expert Advisors</em> prevucite <strong>AITrader_MT5_Bridge</strong> na bilo koji grafikon i uključite dugme <strong>Algo Trading</strong> na vrhu MT5.
                    </p>
                  </div>
                </div>

                {/* Step 4 */}
                <div className="flex items-start gap-3 p-3.5 rounded-xl bg-neutral-900/50 border border-neutral-800">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-500/20 text-blue-400 font-bold font-mono text-xs">
                    4
                  </div>
                  <div className="space-y-1 min-w-0 flex-1">
                    <h4 className="font-semibold text-white">Automatsko praćenje i Stop Loss</h4>
                    <p className="text-neutral-400">
                      Status u tabu <em>Status & Telemetrija</em> će se promeniti u <strong className="text-emerald-400">MT5 ONLINE</strong>. Sve pozicije, TP1 uzimanje 50% profita, pomeranje na Break-Even i Trailing Stop rade 100% samostalno.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 border-t border-neutral-800 bg-neutral-900/40 text-xs text-neutral-400">
          <div className="flex items-center gap-1.5 font-mono text-[11px]">
            <span className="h-2 w-2 rounded-full bg-blue-400 shrink-0"></span>
            <span className="truncate">Vantage MT5 Execution Layer</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-xl bg-neutral-800 hover:bg-neutral-700 text-white transition-colors cursor-pointer text-xs"
          >
            Zatvori
          </button>
        </div>

      </div>
    </div>
  );
};
