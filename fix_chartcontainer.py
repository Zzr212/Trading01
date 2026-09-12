import re

with open('src/components/ChartContainer.tsx', 'r') as f:
    content = f.read()

# 1. Update Props
props_repl = r"interface Props \{\n  symbol: string;"
content = re.sub(props_repl, "interface Props {\n  symbol: string;\n  onBack: () => void;", content)

# 2. Update Component signature
sig_repl = r"export default function ChartContainer\(\{ symbol, activeTrade, onPriceUpdate, onSentimentUpdate, onTradeCreated, onError \}: Props\) \{"
content = re.sub(sig_repl, "export default function ChartContainer({ symbol, onBack, activeTrade, onPriceUpdate, onSentimentUpdate, onTradeCreated, onError }: Props) {", content)

# 3. Add Home to lucide-react import
import_repl = r"import \{ ChevronDown \} from 'lucide-react';"
content = re.sub(import_repl, "import { ChevronDown, Home } from 'lucide-react';", content)

# 4. Modify the timeframe button container
timeframe_div = r"<div className=\"absolute top-4 right-4 z-20\">\n        <button"
new_timeframe_div = """<div className="absolute top-4 right-4 z-20 flex items-center gap-2">
        <button 
          onClick={onBack}
          title="Back to Dashboard"
          className="flex items-center justify-center p-1.5 bg-neutral-900/80 backdrop-blur-sm border border-neutral-800 rounded-md text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
        >
          <Home size={18} />
        </button>
        <button"""
content = content.replace("<div className=\"absolute top-4 right-4 z-20\">\n        <button", new_timeframe_div)

with open('src/components/ChartContainer.tsx', 'w') as f:
    f.write(content)
