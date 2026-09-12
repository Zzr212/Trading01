import re

with open('src/App.tsx', 'r') as f:
    content = f.read()

content = content.replace("<TradePanel", "<TradePanel activePair={activePair}")

with open('src/App.tsx', 'w') as f:
    f.write(content)

with open('src/components/TradePanel.tsx', 'r') as f:
    content2 = f.read()

content2 = content2.replace("interface Props {", "interface Props {\n  activePair: string;")
content2 = content2.replace("export default function TradePanel({ activeTrade, history, sentimentScore, errors, onClearErrors, activeTab, setActiveTab, onReboot }: Props) {", 
                            "export default function TradePanel({ activePair, activeTrade, history, sentimentScore, errors, onClearErrors, activeTab, setActiveTab, onReboot }: Props) {")

with open('src/components/TradePanel.tsx', 'w') as f:
    f.write(content2)
