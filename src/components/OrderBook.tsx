import React, { useState, useEffect, useRef } from 'react';

interface Order {
  price: string;
  amount: string;
  total: number;
}

export default function OrderBook({ symbol }: { symbol: string }) {
  const [bids, setBids] = useState<Order[]>([]);
  const [asks, setAsks] = useState<Order[]>([]);
  
  const maxTotal = useRef<number>(0);

  useEffect(() => {
    const ws = new WebSocket(`wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@depth10@100ms`);
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.bids && data.asks) {
        let currentTotalAsks = 0;
        const newAsks = data.asks.map((a: string[]) => {
          currentTotalAsks += parseFloat(a[1]);
          return { price: parseFloat(a[0]).toFixed(2), amount: parseFloat(a[1]).toFixed(4), total: currentTotalAsks };
        }).reverse(); // Reverse asks to show lowest ask at the bottom
        
        let currentTotalBids = 0;
        const newBids = data.bids.map((b: string[]) => {
          currentTotalBids += parseFloat(b[1]);
          return { price: parseFloat(b[0]).toFixed(2), amount: parseFloat(b[1]).toFixed(4), total: currentTotalBids };
        });

        maxTotal.current = Math.max(currentTotalAsks, currentTotalBids);
        
        setAsks(newAsks);
        setBids(newBids);
      }
    };

    return () => ws.close();
  }, [symbol]);

  return (
    <div className="w-full h-full flex flex-col bg-neutral-950 text-xs font-mono">
      <div className="flex justify-between px-4 py-2 border-b border-neutral-900 text-neutral-500 uppercase font-bold text-[10px]">
        <span>Size</span>
        <span>Price</span>
        <span>Size</span>
      </div>
      
      <div className="flex-1 overflow-hidden flex">
        {/* Bids (Left) */}
        <div className="flex-1 flex flex-col relative border-r border-neutral-900 overflow-y-auto">
          {bids.map((b, i) => (
            <div key={i} className="flex justify-between px-2 py-1 relative">
              <div 
                className="absolute inset-y-0 right-0 bg-green-500/10" 
                style={{ width: `${(b.total / maxTotal.current) * 100}%` }}
              />
              <span className="text-neutral-300 relative z-10">{b.amount}</span>
              <span className="text-green-500 relative z-10">{b.price}</span>
            </div>
          ))}
        </div>
        
        {/* Asks (Right) */}
        <div className="flex-1 flex flex-col relative overflow-y-auto">
          {asks.slice().reverse().map((a, i) => ( // Reverse again to display highest at top, lowest at bottom
            <div key={i} className="flex justify-between px-2 py-1 relative">
              <div 
                className="absolute inset-y-0 left-0 bg-red-500/10" 
                style={{ width: `${(a.total / maxTotal.current) * 100}%` }}
              />
              <span className="text-red-500 relative z-10">{a.price}</span>
              <span className="text-neutral-300 relative z-10">{a.amount}</span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
