import re
with open('src/components/TradePanel.tsx', 'r') as f:
    content = f.read()

# Add duration logic
old_tradeitem = '''function TradeItem({ trade, onReview }: { trade: Trade; onReview?: () => void }) {
  const isLong = trade.type === 'LONG';
  
  return (
    <motion.div'''

new_tradeitem = '''function formatTime(ts: number) {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

function TradeItem({ trade, onReview }: { trade: Trade; onReview?: () => void }) {
  const isLong = trade.type === 'LONG';
  
  const durationMs = trade.closeTimestamp ? (trade.closeTimestamp - trade.timestamp) : null;
  const durationStr = durationMs ? `${Math.round(durationMs / 60000)}m ${Math.round((durationMs % 60000)/1000)}s` : '';
  
  return (
    <motion.div'''

content = content.replace(old_tradeitem, new_tradeitem)

# Add duration below the trade type
old_header = '''          <div className="flex items-center gap-2">
            <h3 className="font-bold text-white tracking-tight">{trade.pair}</h3>
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${isLong ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
              {trade.type}
            </span>
          </div>'''

new_header = '''          <div className="flex flex-col">
            <div className="flex items-center gap-2">
              <h3 className="font-bold text-white tracking-tight">{trade.pair || 'BTCUSDT'}</h3>
              <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${isLong ? 'bg-green-500/10 text-green-500' : 'bg-red-500/10 text-red-500'}`}>
                {trade.type}
              </span>
            </div>
            {trade.status !== 'ACTIVE' && (
              <div className="text-[10px] text-neutral-500 mt-0.5 flex flex-wrap gap-1.5">
                <span>{formatTime(trade.timestamp)} &rarr; {trade.closeTimestamp ? formatTime(trade.closeTimestamp) : '...'}</span>
                {durationStr && <span className="text-neutral-400">({durationStr})</span>}
              </div>
            )}
            {trade.status === 'ACTIVE' && (
              <div className="text-[10px] text-neutral-500 mt-0.5">Started: {formatTime(trade.timestamp)}</div>
            )}
          </div>'''

content = content.replace(old_header, new_header)

with open('src/components/TradePanel.tsx', 'w') as f:
    f.write(content)
