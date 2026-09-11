import React from 'react';
import { motion } from 'motion/react';

interface Props {
  sentimentScore: number; // 0 to 100, where 0 is strong sell, 50 is neutral, 100 is strong buy
}

export default function SentimentMeter({ sentimentScore }: Props) {
  // Map score to a position between 0% and 100%
  const clampedScore = Math.max(0, Math.min(100, sentimentScore));
  
  return (
    <div className="flex flex-col gap-2 w-full pt-2">
      <div className="flex justify-between items-center px-1">
        <span className="text-xs font-bold tracking-widest text-red-500 uppercase">Sell</span>
        <span className="text-[10px] font-medium text-neutral-500 uppercase">Algo Market Sentiment</span>
        <span className="text-xs font-bold tracking-widest text-green-500 uppercase">Buy</span>
      </div>
      
      <div className="relative h-2 w-full rounded-full overflow-hidden flex">
        <div className="h-full bg-red-500/80 w-1/2" />
        <div className="h-full bg-green-500/80 w-1/2" />
        
        {/* The White Tick Marker */}
        <motion.div
          animate={{ left: `${clampedScore}%` }}
          transition={{ type: 'spring', stiffness: 100, damping: 20 }}
          className="absolute top-0 h-full w-1.5 bg-white shadow-[0_0_8px_rgba(255,255,255,0.8)] -ml-[3px] rounded-full z-10"
        />
      </div>
    </div>
  );
}
