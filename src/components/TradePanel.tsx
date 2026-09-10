import React, { useState, useMemo } from 'react';
import { Trade } from '../types';
import { Clock, TrendingUp, TrendingDown, CheckCircle2, XCircle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import SentimentMeter from './SentimentMeter';

interface Props {
  activeTrade: Trade | null;
  history: Trade[];
  sentimentScore: number;
}

export default function TradePanel({ activeTrade, history, sentimentScore }: Props) {
  const [activeTab, setActiveTab] = useState<'ACTIVE' | 'HISTORY'>('ACTIVE');

  const { wins, losses, winRate } = useMemo(() => {
    let w = 0, l = 0;
    history.forEach(t => {
      if (t.status === 'WON') w++;
      if (t.status === 'LOST') l++;
    });
    const total = w + l;
    return {
      wins: w,
      losses: l,
      winRate: total > 0 ? Math.round((w / total) * 100) : 0
    };
  }, [history]);

  return (
    <div className="w-full h-full flex flex-col bg-neutral-950 text-neutral-200">
      <div className="px-4 pt-3 pb-2 border-b border-neutral-900 bg-neutral-900/20">
        <SentimentMeter sentimentScore={sentimentScore} />
      </div>

      {/* Tab Navigation */}
      <div className="flex px-4 pt-4 border-b border-neutral-900 gap-8">
        {(['ACTIVE', 'HISTORY'] as const).map(tab => (
          <button
            key={tab}
            onClick={() => setActiveTab(tab)}
            className={`pb-3 text-sm font-semibold transition-colors relative ${activeTab === tab ? 'text-white' : 'text-neutral-500 hover:text-neutral-300'}`}
          >
            {tab.charAt(0) + tab.slice(1).toLowerCase()}
            {activeTab === tab && (
              <motion.div layoutId="activeTab" className="absolute bottom-0 left-0 right-0 h-0.5 bg-neutral-200" />
            )}
          </button>
        ))}
      </div>

      {/* List Container */}
      <div className="flex-1 overflow-y-auto">
        <AnimatePresence mode="popLayout">
          {activeTab === 'ACTIVE' && (
            !activeTrade ? (
              <motion.div key="no-active" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="flex flex-col items-center justify-center h-40 text-neutral-500">
                <div className="w-8 h-8 rounded-full border-2 border-neutral-800 border-t-neutral-500 animate-spin mb-3" />
                <p className="text-sm font-medium">Scanning market via AI...</p>
              </motion.div>
            ) : (
              <TradeItem key={activeTrade.id} trade={activeTrade} />
            )
          )}

          {activeTab === 'HISTORY' && (
            <motion.div key="history-view" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
              <div className="grid grid-cols-3 gap-2 p-4 border-b border-neutral-900/50 text-center">
                <div className="bg-neutral-900/50 p-2 rounded-lg">
                  <span className="block text-[10px] text-neutral-500 uppercase tracking-widest mb-0.5 font-bold">Win Rate</span>
                  <span className="text-lg font-mono text-white">{winRate}%</span>
                </div>
                <div className="bg-green-500/5 p-2 rounded-lg">
                  <span className="block text-[10px] text-green-500/70 uppercase tracking-widest mb-0.5 font-bold">Wins</span>
                  <span className="text-lg font-mono text-green-500">{wins}</span>
                </div>
                <div className="bg-red-500/5 p-2 rounded-lg">
                  <span className="block text-[10px] text-red-500/70 uppercase tracking-widest mb-0.5 font-bold">Losses</span>
                  <span className="text-lg font-mono text-red-500">{losses}</span>
                </div>
              </div>
              
              {history.length === 0 ? (
                <div className="flex flex-col items-center justify-center h-20 text-neutral-600">
                  <p className="text-sm">No completed trades yet.</p>
                </div>
              ) : (
                history.map(trade => <TradeItem key={trade.id} trade={trade} />)
              )}
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

function TradeItem({ trade }: { trade: Trade; key?: React.Key }) {
  const isLong = trade.type === 'LONG';
  
  return (
    <motion.div
      layout
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      className="border-b border-neutral-900/50 p-5 flex flex-col gap-4"
    >
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className={`p-1.5 rounded-full ${isLong ? 'text-green-500 bg-green-500/10' : 'text-red-500 bg-red-500/10'}`}>
            {isLong ? <TrendingUp size={16} /> : <TrendingDown size={16} />}
          </div>
          <div className="flex items-center gap-2">
            <h3 className="font-bold text-white tracking-tight">{trade.pair}</h3>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${isLong ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
              {trade.type}
            </span>
          </div>
        </div>
        
        {trade.status === 'ACTIVE' && <div className="flex items-center gap-1 text-xs text-orange-400 animate-pulse"><Clock size={12}/> Running</div>}
        {trade.status === 'WON' && <div className="flex items-center gap-1 text-xs font-semibold text-green-500"><CheckCircle2 size={14}/> Won</div>}
        {trade.status === 'LOST' && <div className="flex items-center gap-1 text-xs font-semibold text-neutral-500"><XCircle size={14}/> Lost</div>}
      </div>

      <div className="flex justify-between items-center text-sm font-mono">
        <div className="flex flex-col">
          <span className="text-[10px] text-neutral-500 font-sans tracking-wide">ENTRY</span>
          <span className="text-neutral-200">${trade.entryPrice.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </div>
        <div className="flex flex-col items-center">
          <span className="text-[10px] text-neutral-500 font-sans tracking-wide">TAKE PROFIT</span>
          <span className="text-green-500">${trade.takeProfit.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </div>
        <div className="flex flex-col items-end">
          <span className="text-[10px] text-neutral-500 font-sans tracking-wide">STOP LOSS</span>
          <span className="text-red-500">${trade.stopLoss.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
        </div>
      </div>
    </motion.div>
  );
}
