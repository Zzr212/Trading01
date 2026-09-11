import re

with open('src/App.tsx', 'r') as f:
    content = f.read()

old_onTradeCreated = "          onTradeCreated={(t) => setTrades(prev => [t, ...prev])}"
new_onTradeCreated = """          onTradeCreated={(t) => {
            setTrades(prev => [t, ...prev]);
            fetch('/api/trades', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify(t)
            }).catch(e => addError("Failed to save trade: " + e.message));
          }}"""

content = content.replace(old_onTradeCreated, new_onTradeCreated)

with open('src/App.tsx', 'w') as f:
    f.write(content)
