import re

with open('src/components/TradePanel.tsx', 'r') as f:
    content = f.read()

# Remove interface props
content = content.replace("  aiAvailable?: boolean;\n  onOpenKeys?: () => void;\n", "")
content = content.replace("export default function TradePanel({ aiAvailable, onOpenKeys, activeTrade, history, sentimentScore, errors, onClearErrors, activeTab, setActiveTab, onReboot }: Props) {", 
"export default function TradePanel({ activeTrade, history, sentimentScore, errors, onClearErrors, activeTab, setActiveTab, onReboot }: Props) {")

# Remove KeyRound import
content = content.replace(", KeyRound }", " }")

# Remove Keys button
key_btn = r"        <button \n          onClick=\{onOpenKeys\}\n          className=\"flex items-center gap-1\.5 px-3 py-1\.5 rounded-lg text-xs font-semibold bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors\"\n          title=\"API Keys\"\n        >\n          <KeyRound size=\{14\} />\n          Keys\n        </button>\n"
content = re.sub(key_btn, "", content)

# Remove AI Offline indicator
ai_offline = r"              \{aiAvailable === false && \(\n                <span className=\"flex items-center gap-1\.5 text-\[10px\] uppercase tracking-wider font-bold text-red-500 bg-red-500/10 px-2 py-0\.5 rounded-full ml-2\">\n                  <div className=\"w-1\.5 h-1\.5 rounded-full bg-red-500 animate-pulse\" />\n                  AI Offline\n                </span>\n              \)\}\n"
content = re.sub(ai_offline, "", content)

with open('src/components/TradePanel.tsx', 'w') as f:
    f.write(content)
