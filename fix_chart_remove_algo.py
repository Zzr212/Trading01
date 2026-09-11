import re

with open('src/components/ChartContainer.tsx', 'r') as f:
    content = f.read()

# The algorithmic logic is inside a useEffect
# Let's just find and replace the whole block
algo_logic = r"  // Algorithmic Scalping Strategy.*?\n  \}, \[enrichedData, activeTrade, srLevels, onPriceUpdate, onSentimentUpdate, onTradeCreated, onError\]\);\n"

# Actually, the comment was "// Algorithmic Trade Trigger Logic"
algo_logic = r"  // Algorithmic Trade Trigger Logic\n  useEffect\(\(\) => \{.*?    }, 5000\); // Debounce\n    \n  \}, \[enrichedData, activeTrade, srLevels, onPriceUpdate, onSentimentUpdate, onTradeCreated, onError\]\);"

content = re.sub(algo_logic, "", content, flags=re.DOTALL)

with open('src/components/ChartContainer.tsx', 'w') as f:
    f.write(content)
