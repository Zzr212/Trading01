import re

with open('src/components/TradeReplayModal.tsx', 'r') as f:
    content = f.read()

# Change the frame building logic to just be cumulative candles
new_logic = """        if (data.success && data.candles && data.candles.length > 0) {
          const rawData = data.candles as Kline[];
          
          const builtFrames: Kline[][] = [];
          let currentFrame: Kline[] = [];
          
          // Since these are 1m closed candles from historical API, just add them one by one
          rawData.forEach(kline => {
            currentFrame.push(kline);
            builtFrames.push([...currentFrame]);
          });
          
          setFrames(builtFrames);
          
          // Find the frame where the trade started
          let startIdx = 0;
          for (let i = 0; i < builtFrames.length; i++) {
            const frame = builtFrames[i];
            if (frame[frame.length - 1].time >= trade.timestamp) {
              startIdx = i;
              break;
            }
          }
          
          // If we can't find it, or it's the very first candle, just start at index 10 (as backend gives 10 prior)
          if (startIdx === 0 && builtFrames.length > 10) startIdx = 10;
          
          setCurrentIndex(startIdx);
          setVisibleCandles(builtFrames[startIdx].slice(-100)); // Show max 100 candles
        }"""

content = re.sub(r"        if \(data\.success && data\.candles && data\.candles\.length > 0\) \{.*?        \}", new_logic, content, flags=re.DOTALL)

# Adjust playback speed from 100ms to 800ms base
content = content.replace("timerRef.current = setInterval(playStep, 100 / speed);", "timerRef.current = setInterval(playStep, 800 / speed);")

# Also add an error state if the fetch fails or candles are empty
# Wait, if frames.length == 0, it just says Loading. What if data.candles is empty?
# Let's add a state for empty
with open('src/components/TradeReplayModal.tsx', 'w') as f:
    f.write(content)
