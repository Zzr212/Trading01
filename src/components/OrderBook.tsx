import React, { useState, useEffect, useRef } from 'react';

interface Order {
  price: string;
  amount: string;
  total: number;
}

export default function OrderBook({ symbol }: { symbol: string }) {
  const [bids, setBids] = useState<Order[]>([]);
  const [asks, setAsks] = useState<Order[]>([]);
  
  const maxTotal = useRef<number>(1);

  useEffect(() => {
    if (!symbol) return;
    let ws: WebSocket | null = null;
    try {
      ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@depth10@100ms`);
      
      ws.onmessage = (event) => {
        try {
          const data = JSON.parse(event.data);
          if (data.bids && data.asks) {
            let currentTotalAsks = 0;
            const newAsks = data.asks.map((a: string[]) => {
              currentTotalAsks += parseFloat(a[1]);
              return { price: parseFloat(a[0]).toFixed(2), amount: parseFloat(a[1]).toFixed(4), total: currentTotalAsks };
            });
            
            let currentTotalBids = 0;
            const newBids = data.bids.map((b: string[]) => {
              currentTotalBids += parseFloat(b[1]);
              return { price: parseFloat(b[0]).toFixed(2), amount: parseFloat(b[1]).toFixed(4), total: currentTotalBids };
            });

            maxTotal.current = Math.max(1, currentTotalAsks, currentTotalBids);
            
            setAsks(newAsks);
            setBids(newBids);
          }
        } catch (e) {
          // ignore parsing error
        }
      };
      
      ws.onerror = () => {};
    } catch (err) {
      // ignore
    }

    return () => {
      if (ws) {
        try { ws.close(); } catch(e) {}
      }
    };
  }, [symbol]);

  return (
    <div className="w-full h-full flex flex-col bg-neutral-950 text-xs font-mono select-none">
      <div className="flex justify-between px-4 py-2 border-b border-neutral-900 text-neutral-500 uppercase font-bold text-[10px]">
        <div className="flex gap-4">
          <span className="w-16">Size</span>
          <span>Bid Price</span>
        </div>
        <div className="flex gap-4 text-right">
          <span>Ask Price</span>
          <span className="w-16">Size</span>
        </div>
      </div>
      
      <div className="flex-1 overflow-hidden flex divide-x divide-neutral-900">
        {/* Bids (Left) */}
        <div className="flex-1 flex flex-col relative overflow-y-auto">
          {bids.length === 0 ? (
            <div className="p-4 text-center text-neutral-600">Connecting depth...</div>
          ) : (
            bids.map((b, i) => (
              <div key={i} className="flex justify-between px-3 py-1 relative hover:bg-neutral-900/40">
                <div 
                  className="absolute inset-y-0 right-0 bg-green-500/10 pointer-events-none" 
                  style={{ width: `${Math.min(100, (b.total / maxTotal.current) * 100)}%` }}
                />
                <span className="text-neutral-400 relative z-10 w-16">{b.amount}</span>
                <span className="text-green-400 font-semibold relative z-10">{b.price}</span>
              </div>
            ))
          )}
        </div>
        
        {/* Asks (Right) */}
        <div className="flex-1 flex flex-col relative overflow-y-auto">
          {asks.length === 0 ? (
            <div className="p-4 text-center text-neutral-600">Connecting depth...</div>
          ) : (
            asks.map((a, i) => (
              <div key={i} className="flex justify-between px-3 py-1 relative hover:bg-neutral-900/40">
                <div 
                  className="absolute inset-y-0 left-0 bg-red-500/10 pointer-events-none" 
                  style={{ width: `${Math.min(100, (a.total / maxTotal.current) * 100)}%` }}
                />
                <span className="text-red-400 font-semibold relative z-10">{a.price}</span>
                <span className="text-neutral-400 relative z-10 w-16 text-right">{a.amount}</span>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
