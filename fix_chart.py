import re

with open('src/components/CandlestickChart.tsx', 'r') as f:
    content = f.read()

old_block = """      // Keep historical view stable when new data arrives
      if (prevDataLengthRef.current > 0 && data.length > prevDataLengthRef.current) {
        const diff = data.length - prevDataLengthRef.current;
        // If the user has scrolled into the past (offset > 0), increment offset to maintain their visual position
        if (stateRef.current.offset > 0) {
          stateRef.current.offset += diff;
        }
      }
      prevDataLengthRef.current = data.length;
    }
    
    requestAnimationFrame(draw);"""

new_block = """      // Keep historical view stable when new data arrives
      if (prevDataLengthRef.current > 0 && data.length > prevDataLengthRef.current && (data.length - prevDataLengthRef.current < 50)) {
        const diff = data.length - prevDataLengthRef.current;
        // If the user has scrolled into the past (offset > 0), increment offset to maintain their visual position
        if (stateRef.current.offset > 0) {
          stateRef.current.offset += diff;
        }
      } else if (prevDataLengthRef.current === 0 || Math.abs(data.length - prevDataLengthRef.current) > 50) {
        // Data completely changed or first load, reset offset
        stateRef.current.offset = isReplay ? 0 : -20;
      }
      prevDataLengthRef.current = data.length;
    } else {
      prevDataLengthRef.current = 0;
    }
    
    requestAnimationFrame(draw);"""

content = content.replace(old_block, new_block)

with open('src/components/CandlestickChart.tsx', 'w') as f:
    f.write(content)
