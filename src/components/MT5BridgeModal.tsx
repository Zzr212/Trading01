import React, { useState, useEffect } from 'react';
import { 
  X, Check, Copy, Download, RefreshCw, Server, ShieldCheck, 
  AlertCircle, ArrowRight, ExternalLink, Cpu, Sliders, FileCode, CheckCircle2 
} from 'lucide-react';
import { PAIRS } from '../types';
import { generateMql5EACode } from '../mt5_bridge';

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
  const [copied, setCopied] = useState(false);
  const [saveSuccess, setSaveSuccess] = useState(false);

  const [config, setConfig] = useState<MT5Config>({
    enabled: true,
    serverUrl: window.location.origin,
    magicNumber: 889900,
    slippagePoints: 50,
    lotSizes: {
      "BTCUSDT": 0.01,
      "ETHUSDT": 0.05,
      "SOLUSDT": 0.20,
      "BNBUSDT": 0.10,
      "XRPUSDT": 10.0,
      "DOGEUSDT": 100.0
    },
    symbolMappings: {
      "BTCUSDT": "BTCUSD",
      "ETHUSDT": "ETHUSD",
      "SOLUSDT": "SOLUSD",
      "BNBUSDT": "BNBUSD",
      "XRPUSDT": "XRPUSD",
      "DOGEUSDT": "DOGEUSD"
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
        if (data.config) {
          const resolvedUrl = data.config.serverUrl || window.location.origin;
          setConfig(prev => ({
            ...prev,
            ...data.config,
            serverUrl: resolvedUrl
          }));
          setEaCode(generateMql5EACode(resolvedUrl));
        }
        if (data.status) {
          setStatus(data.status);
        }
      }
    } catch (e: any) {
      if (e?.name !== 'AbortError') {
        // Silently tolerate transient network delays without spamming console errors
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
    const blob = new Blob([eaCode], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'AITrader_MT5_Bridge.mq5';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  if (!isOpen) return null;

  const isRecentlyConnected = status.connected && (Date.now() - status.lastHeartbeat < 30000);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/80 backdrop-blur-md animate-in fade-in duration-200">
      <div className="relative w-full max-w-4xl bg-neutral-950 border border-neutral-800 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-800/80 bg-neutral-900/50">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-xl bg-gradient-to-br from-blue-500/20 to-indigo-500/20 border border-blue-500/30 text-blue-400">
              <Server size={20} />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-bold text-white tracking-wide">MetaTrader 5 (MT5) Bridge</h2>
                <span className="text-[10px] uppercase font-mono px-2 py-0.5 rounded-full bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  Realtime Algo
                </span>
              </div>
              <p className="text-xs text-neutral-400">Povezivanje web trading bota sa Vašim Vantage MT5 terminalom na laptopu</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={fetchData}
              className="p-2 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-neutral-400 hover:text-white border border-neutral-800 transition-colors cursor-pointer"
              title="Osveži podatke"
            >
              <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
            </button>
            <button
              onClick={onClose}
              className="p-2 rounded-lg bg-neutral-900 hover:bg-neutral-800 text-neutral-400 hover:text-white border border-neutral-800 transition-colors cursor-pointer"
            >
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Live Status Pill & Tabs */}
        <div className="flex flex-wrap items-center justify-between gap-3 px-6 py-3 bg-neutral-900/30 border-b border-neutral-900">
          <div className="flex items-center gap-1.5 p-1 bg-neutral-900 rounded-xl border border-neutral-800">
            <button
              onClick={() => setActiveTab('status')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                activeTab === 'status' 
                  ? 'bg-neutral-800 text-white shadow' 
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              Check View (Status)
            </button>
            <button
              onClick={() => setActiveTab('lots')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                activeTab === 'lots' 
                  ? 'bg-neutral-800 text-white shadow' 
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              Lot Size & Simboli
            </button>
            <button
              onClick={() => setActiveTab('code')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                activeTab === 'code' 
                  ? 'bg-neutral-800 text-white shadow' 
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              MQL5 Kod (EA)
            </button>
            <button
              onClick={() => setActiveTab('instructions')}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium transition-all cursor-pointer ${
                activeTab === 'instructions' 
                  ? 'bg-neutral-800 text-white shadow' 
                  : 'text-neutral-400 hover:text-neutral-200'
              }`}
            >
              Uputstvo
            </button>
          </div>

          <div className="flex items-center gap-2">
            <div className={`flex items-center gap-2 px-3 py-1 rounded-full text-xs font-mono border ${
              isRecentlyConnected 
                ? 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' 
                : 'bg-amber-500/10 text-amber-400 border-amber-500/30'
            }`}>
              <span className={`h-2 w-2 rounded-full ${isRecentlyConnected ? 'bg-emerald-400 animate-pulse' : 'bg-amber-400'}`}></span>
              <span>{isRecentlyConnected ? 'MT5 CONNECTED (ONLINE)' : 'ČEKAM MT5 EXPERT ADVISOR'}</span>
            </div>
          </div>
        </div>

        {/* Content Body */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-sm text-neutral-300">
          
          {/* TAB 1: STATUS / CHECK VIEW */}
          {activeTab === 'status' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              {/* Connection Banner */}
              <div className={`p-4 rounded-xl border flex items-start gap-3 ${
                isRecentlyConnected 
                  ? 'bg-emerald-950/20 border-emerald-800/40 text-emerald-200' 
                  : 'bg-neutral-900/80 border-neutral-800 text-neutral-300'
              }`}>
                <div className={`p-2 rounded-lg mt-0.5 ${isRecentlyConnected ? 'bg-emerald-500/20 text-emerald-400' : 'bg-neutral-800 text-neutral-400'}`}>
                  {isRecentlyConnected ? <ShieldCheck size={20} /> : <AlertCircle size={20} />}
                </div>
                <div>
                  <h3 className="font-semibold text-white">
                    {isRecentlyConnected 
                      ? 'MetaTrader 5 je uspešno povezan i sinhronizovan!' 
                      : 'Nema aktivne konekcije sa MetaTrader 5 terminalom'}
                  </h3>
                  <p className="text-xs text-neutral-400 mt-1 leading-relaxed">
                    {isRecentlyConnected
                      ? `Vaš MT5 Expert Advisor na laptopu redovno šalje puls (svakih ${Math.max(1, Math.round((Date.now() - status.lastHeartbeat) / 1000))}s). Svi novi trejdovi i ažuriranja Stop Loss-a se prenose u realnom vremenu.`
                      : 'Za aktivaciju, preuzmite i kompajlirajte priloženi MQL5 kod u MetaEditoru na Vašem laptopu, unesite URL servera u MT5 WebRequest i pokrenite EA na bilo kom grafikonu.'}
                  </p>
                </div>
              </div>

              {/* Terminal Telemetry Cards */}
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="bg-neutral-900/60 border border-neutral-800/80 p-3.5 rounded-xl">
                  <div className="text-[11px] text-neutral-500 uppercase tracking-wider font-mono">Broker</div>
                  <div className="text-base font-bold text-white mt-1 truncate">{status.broker || (isRecentlyConnected ? 'Vantage' : 'N/A')}</div>
                  <div className="text-[10px] text-neutral-500 mt-0.5">Acc: {status.accountNumber || 'N/A'}</div>
                </div>

                <div className="bg-neutral-900/60 border border-neutral-800/80 p-3.5 rounded-xl">
                  <div className="text-[11px] text-neutral-500 uppercase tracking-wider font-mono">MT5 Balance</div>
                  <div className="text-base font-bold text-emerald-400 mt-1 font-mono">
                    ${status.balance ? status.balance.toLocaleString('en-US', { minimumFractionDigits: 2 }) : '0.00'}
                  </div>
                  <div className="text-[10px] text-neutral-500 mt-0.5">Equity: ${status.equity ? status.equity.toFixed(2) : '0.00'}</div>
                </div>

                <div className="bg-neutral-900/60 border border-neutral-800/80 p-3.5 rounded-xl">
                  <div className="text-[11px] text-neutral-500 uppercase tracking-wider font-mono">Slobodna Margina</div>
                  <div className="text-base font-bold text-white mt-1 font-mono">
                    ${status.freeMargin ? status.freeMargin.toFixed(2) : '0.00'}
                  </div>
                  <div className="text-[10px] text-neutral-500 mt-0.5">Iskorišćena: ${status.margin ? status.margin.toFixed(2) : '0.00'}</div>
                </div>

                <div className="bg-neutral-900/60 border border-neutral-800/80 p-3.5 rounded-xl">
                  <div className="text-[11px] text-neutral-500 uppercase tracking-wider font-mono">Otvorene AI Pozicije</div>
                  <div className="text-base font-bold text-blue-400 mt-1 font-mono">
                    {status.openPositionsCount}
                  </div>
                  <div className="text-[10px] text-neutral-500 mt-0.5">Magic: {config.magicNumber}</div>
                </div>
              </div>

              {/* Endpoint Information */}
              <div className="bg-neutral-900/40 border border-neutral-800/80 rounded-xl p-4 space-y-3">
                <h4 className="text-xs font-semibold text-neutral-300 uppercase tracking-wider font-mono flex items-center gap-2">
                  <Cpu size={14} className="text-blue-400" />
                  Putanja servera za WebRequest u MT5
                </h4>
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    readOnly
                    value={config.serverUrl || window.location.origin}
                    className="flex-1 bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-xs font-mono text-emerald-400 focus:outline-none"
                  />
                  <button
                    onClick={() => {
                      navigator.clipboard.writeText(config.serverUrl || window.location.origin);
                      setCopied(true);
                      setTimeout(() => setCopied(false), 2000);
                    }}
                    className="px-3 py-2 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer"
                  >
                    {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                    <span>{copied ? 'Kopirano' : 'Kopiraj URL'}</span>
                  </button>
                </div>
                <p className="text-[11px] text-neutral-500">
                  Ovaj URL obavezno morate dodati u MT5 u: <span className="text-neutral-300 font-mono">Tools → Options → Expert Advisors → Allow WebRequest for listed URL</span>.
                </p>
              </div>
            </div>
          )}

          {/* TAB 2: LOT SIZES & SYMBOL MAPPING */}
          {activeTab === 'lots' && (
            <div className="space-y-6 animate-in fade-in duration-150">
              <div className="flex items-center justify-between">
                <div>
                  <h3 className="text-sm font-semibold text-white">Konfiguracija lota i naziva simbola u MT5</h3>
                  <p className="text-xs text-neutral-400">Podesite željeni lot (Volume) koji će EA otvarati na Vašem nalogu za svaki kripto par.</p>
                </div>
                <button
                  onClick={handleSaveConfig}
                  disabled={saving}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:opacity-50 text-white text-xs font-medium rounded-xl transition-colors shadow-lg flex items-center gap-2 cursor-pointer"
                >
                  {saving ? <RefreshCw size={14} className="animate-spin" /> : saveSuccess ? <CheckCircle2 size={14} className="text-emerald-300" /> : <Sliders size={14} />}
                  <span>{saveSuccess ? 'Sačuvano!' : 'Sačuvaj Podešavanja'}</span>
                </button>
              </div>

              {/* Table */}
              <div className="overflow-x-auto rounded-xl border border-neutral-800">
                <table className="w-full text-left border-collapse text-xs">
                  <thead>
                    <tr className="bg-neutral-900/80 border-b border-neutral-800 text-neutral-400 font-mono">
                      <th className="py-2.5 px-4">Bot Simbol (Binance)</th>
                      <th className="py-2.5 px-4">MT5 Simbol kod brokera (Vantage)</th>
                      <th className="py-2.5 px-4">Trgovani Lot (Volume)</th>
                      <th className="py-2.5 px-4">Preporučeni Min. Lot</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-neutral-850">
                    {PAIRS.map(pair => {
                      const currentLot = config.lotSizes[pair] ?? 0.01;
                      const currentMt5Sym = config.symbolMappings[pair] ?? pair.replace('USDT', 'USD');
                      
                      return (
                        <tr key={pair} className="hover:bg-neutral-900/40 transition-colors">
                          <td className="py-3 px-4 font-mono font-bold text-white">
                            {pair}
                          </td>
                          <td className="py-3 px-4">
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
                              placeholder="npr. BTCUSD ili BTCUSDT"
                              className="bg-neutral-950 border border-neutral-800 rounded-lg px-2.5 py-1.5 text-xs font-mono text-neutral-200 focus:border-blue-500 focus:outline-none w-36"
                            />
                          </td>
                          <td className="py-3 px-4">
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
                              className="bg-neutral-950 border border-neutral-800 rounded-lg px-2.5 py-1.5 text-xs font-mono text-emerald-400 font-bold focus:border-blue-500 focus:outline-none w-28"
                            />
                          </td>
                          <td className="py-3 px-4 text-neutral-500 font-mono text-[11px]">
                            {pair === 'BTCUSDT' ? '0.01 (1 mikrolot)' : pair === 'ETHUSDT' ? '0.05' : pair === 'DOGEUSDT' ? '10 - 100' : '0.10'}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              {/* Extra Risk Controls */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 p-4 rounded-xl bg-neutral-900/40 border border-neutral-800">
                <div>
                  <label className="text-xs font-medium text-neutral-300 block mb-1">MT5 Magic Number</label>
                  <input
                    type="number"
                    value={config.magicNumber}
                    onChange={(e) => setConfig(prev => ({ ...prev, magicNumber: parseInt(e.target.value) || 889900 }))}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none"
                  />
                  <span className="text-[10px] text-neutral-500 mt-1 block">Jedinstveni identifikator po kome EA razlikuje svoje trejdove od ručnih</span>
                </div>
                <div>
                  <label className="text-xs font-medium text-neutral-300 block mb-1">Maksimalni Slippage (u poenima)</label>
                  <input
                    type="number"
                    value={config.slippagePoints}
                    onChange={(e) => setConfig(prev => ({ ...prev, slippagePoints: parseInt(e.target.value) || 50 }))}
                    className="w-full bg-neutral-950 border border-neutral-800 rounded-lg px-3 py-2 text-xs font-mono text-white focus:outline-none"
                  />
                  <span className="text-[10px] text-neutral-500 mt-1 block">Maksimalno dozvoljeno cenovno odstupanje pri egzekuciji naloga</span>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: MQL5 EA SOURCE CODE */}
          {activeTab === 'code' && (
            <div className="space-y-4 animate-in fade-in duration-150">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div>
                  <h3 className="text-sm font-semibold text-white">MQL5 Expert Advisor Izvorni Kod (.mq5)</h3>
                  <p className="text-xs text-neutral-400">Kompletan kod koji ubacujete u MetaEditor na Vašem laptopu.</p>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCopyCode}
                    className="px-3 py-1.5 bg-neutral-800 hover:bg-neutral-700 text-white rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer shadow"
                  >
                    {copied ? <Check size={14} className="text-emerald-400" /> : <Copy size={14} />}
                    <span>{copied ? 'Kopirano u Clipboard!' : 'Kopiraj Celokupan Kod'}</span>
                  </button>
                  <button
                    onClick={handleDownloadFile}
                    className="px-3 py-1.5 bg-blue-600 hover:bg-blue-500 text-white rounded-lg text-xs font-medium transition-colors flex items-center gap-1.5 cursor-pointer shadow"
                  >
                    <Download size={14} />
                    <span>Preuzmi .mq5 Fajl</span>
                  </button>
                </div>
              </div>

              {/* Code Display Area */}
              <div className="relative rounded-xl border border-neutral-800 bg-neutral-950 overflow-hidden">
                <div className="flex items-center justify-between px-4 py-2 border-b border-neutral-850 bg-neutral-900/60 text-xs font-mono text-neutral-400">
                  <div className="flex items-center gap-2">
                    <FileCode size={14} className="text-blue-400" />
                    <span>AITrader_MT5_Bridge.mq5</span>
                  </div>
                  <span>UTF-8 | MQL5</span>
                </div>
                <pre className="p-4 text-xs font-mono text-neutral-300 overflow-x-auto max-h-[380px] leading-relaxed selection:bg-blue-500 selection:text-white">
                  {eaCode || '// Učitavanje koda sa servera...'}
                </pre>
              </div>
            </div>
          )}

          {/* TAB 4: STEP-BY-STEP INSTRUCTIONS */}
          {activeTab === 'instructions' && (
            <div className="space-y-6 animate-in fade-in duration-150 text-xs leading-relaxed">
              <h3 className="text-sm font-bold text-white">Kako povezati MT5 na laptopu sa ovim algoritmom u 4 koraka:</h3>

              <div className="space-y-4">
                {/* Step 1 */}
                <div className="flex items-start gap-3 p-3.5 rounded-xl bg-neutral-900/50 border border-neutral-800">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-500/20 text-blue-400 font-bold font-mono text-xs">
                    1
                  </div>
                  <div className="space-y-1.5">
                    <h4 className="font-semibold text-white">Dozvola WebRequest komunikacije u MetaTraderu 5</h4>
                    <p className="text-neutral-400">
                      U Vašem MetaTrader 5 programu na laptopu idite u gornji meni:
                    </p>
                    <div className="p-2 rounded bg-neutral-950 font-mono text-neutral-300 text-[11px] border border-neutral-850">
                      Tools → Options (ili prečica Ctrl + O) → Tab "Expert Advisors"
                    </div>
                    <ul className="list-disc list-inside text-neutral-400 space-y-1 pl-1">
                      <li>Označite kućicu <strong className="text-neutral-200">"Allow Algo Trading"</strong></li>
                      <li>Označite kućicu <strong className="text-neutral-200">"Allow WebRequest for listed URL"</strong></li>
                      <li>Kliknite na zeleni plus (<strong className="text-emerald-400">+</strong>) i dodajte tačnu adresu ovog servera:</li>
                    </ul>
                    <div className="p-2 rounded bg-neutral-950 font-mono text-emerald-400 text-[11px] border border-neutral-850 flex items-center justify-between">
                      <span>{config.serverUrl || window.location.origin}</span>
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(config.serverUrl || window.location.origin);
                          setCopied(true);
                          setTimeout(() => setCopied(false), 2000);
                        }}
                        className="text-neutral-400 hover:text-white transition-colors cursor-pointer"
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
                  <div className="space-y-1.5">
                    <h4 className="font-semibold text-white">Kreiranje i kompilacija Expert Advisora u MetaEditoru</h4>
                    <ul className="list-disc list-inside text-neutral-400 space-y-1 pl-1">
                      <li>U MetaTraderu 5 pritisnite taster <strong className="text-neutral-200">F4</strong> da otvorite MetaEditor.</li>
                      <li>Kliknite na <strong className="text-neutral-200">New</strong> (Novi fajl) → Izaberite <strong className="text-neutral-200">Expert Advisor (template)</strong> → Next.</li>
                      <li>Nazovite ga <span className="font-mono text-blue-300">AITrader_MT5_Bridge</span> i kliknite Finish.</li>
                      <li>Obrišite sve iz tog fajla i zalepite kompletan kod iz taba <strong className="text-neutral-200">"MQL5 Kod (EA)"</strong>.</li>
                      <li>Pritisnite taster <strong className="text-emerald-400">F7</strong> (ili kliknite dugme <em>Compile</em> na vrhu). Na dnu u "Errors" mora pisati <strong>0 errors, 0 warnings</strong>.</li>
                    </ul>
                  </div>
                </div>

                {/* Step 3 */}
                <div className="flex items-start gap-3 p-3.5 rounded-xl bg-neutral-900/50 border border-neutral-800">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-500/20 text-blue-400 font-bold font-mono text-xs">
                    3
                  </div>
                  <div className="space-y-1.5">
                    <h4 className="font-semibold text-white">Pokretanje EA na grafikonu u MT5</h4>
                    <ul className="list-disc list-inside text-neutral-400 space-y-1 pl-1">
                      <li>Vratite se u MT5 prozor. Otvorite grafikon bilo kog para (npr. <span className="font-mono text-neutral-200">BTCUSD</span>).</li>
                      <li>U levom panelu <strong className="text-neutral-200">Navigator</strong> (Ctrl + N) pod <strong className="text-neutral-200">Expert Advisors</strong> pronađite <em>AITrader_MT5_Bridge</em>.</li>
                      <li>Prevucite ga mišem na grafikon. U prozoru koji se pojavi pod tabom <em>Common</em> proverite da je čekirano <strong className="text-neutral-200">"Allow Algo Trading"</strong> i kliknite OK.</li>
                      <li>U gornjoj traci MT5 terminala proverite da li je dugme <strong className="text-emerald-400">"Algo Trading"</strong> upaljeno (zelena ikonica).</li>
                    </ul>
                  </div>
                </div>

                {/* Step 4 */}
                <div className="flex items-start gap-3 p-3.5 rounded-xl bg-neutral-900/50 border border-neutral-800">
                  <div className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-blue-500/20 text-blue-400 font-bold font-mono text-xs">
                    4
                  </div>
                  <div className="space-y-1.5">
                    <h4 className="font-semibold text-white">Potvrda rada i provera statusa</h4>
                    <p className="text-neutral-400">
                      U roku od 5-10 sekundi, status u ovom modalu (tab <em>Check View</em>) će se promeniti u zeleno: <strong className="text-emerald-400">MT5 CONNECTED (ONLINE)</strong> i videćete Vaš Vantage balans i equity. Od tog trenutka svaki trejd i pomeranje Stop Loss-a se izvršavaju automatski!
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Footer */}
        <div className="flex items-center justify-between px-6 py-3 border-t border-neutral-800/80 bg-neutral-900/50 text-xs text-neutral-400">
          <div className="flex items-center gap-2">
            <span className="h-2 w-2 rounded-full bg-blue-400"></span>
            <span>Vantage MT5 Realtime Execution Layer</span>
          </div>
          <button
            onClick={onClose}
            className="px-4 py-1.5 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-white transition-colors cursor-pointer"
          >
            Zatvori
          </button>
        </div>

      </div>
    </div>
  );
};
