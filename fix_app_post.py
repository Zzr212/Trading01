import re

with open('src/App.tsx', 'r') as f:
    content = f.read()

# Add handleTradeCreated
new_func = """  const handleTradeCreated = useCallback(async (t: Trade) => {
    setTrades(prev => [t, ...prev]);
    try {
      await fetch('/api/trades', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(t)
      });
    } catch (e: any) {
      addError("Failed to save trade: " + e.message);
    }
  }, [addError]);

  // Evaluate Active Trade"""

content = content.replace("  // Evaluate Active Trade", new_func)

# Update ChartContainer props
content = content.replace("onTradeCreated={(t) => setTrades(prev => [t, ...prev])}", "onTradeCreated={handleTradeCreated}")

with open('src/App.tsx', 'w') as f:
    f.write(content)

