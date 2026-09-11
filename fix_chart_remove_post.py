import re

with open('src/components/ChartContainer.tsx', 'r') as f:
    content = f.read()

# We want to remove these two blocks:
# 1. The useEffect that records candles
record_effect = r"  // Handle active trade recording.*?  \}, \[enrichedData, activeTrade\]\);\n"
content = re.sub(record_effect, "", content, flags=re.DOTALL)

# 2. The useEffect that posts them
post_effect = r"  const lastActiveTradeIdRef = useRef<string \| null>\(null\);\n  \n  useEffect\(\(\) => \{.*?    \} else if \(lastActiveTradeIdRef.current && recordedCandlesRef.current.length > 0\) \{.*?      \}\)\.catch.*?      recordedCandlesRef.current = \[\]; // Clear for next trade\n    \}\n  \}, \[activeTrade, onError\]\);\n"
content = re.sub(post_effect, "", content, flags=re.DOTALL)

with open('src/components/ChartContainer.tsx', 'w') as f:
    f.write(content)
