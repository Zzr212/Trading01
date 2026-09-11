import re

with open('src/App.tsx', 'r') as f:
    content = f.read()

# Change the useEffect to poll every 5 seconds
old_effect = """  useEffect(() => {
    fetchTrades();
  }, [fetchTrades]);"""

new_effect = """  useEffect(() => {
    fetchTrades();
    const interval = setInterval(fetchTrades, 3000);
    return () => clearInterval(interval);
  }, [fetchTrades]);"""

content = content.replace(old_effect, new_effect)

# And remove evaluate active trade in UI (it's handled by backend now)
eval_trade = r"  // Evaluate Active Trade.*?\n  \}, \[currentPrice, trades, addError\]\);\n"
content = re.sub(eval_trade, "", content, flags=re.DOTALL)

with open('src/App.tsx', 'w') as f:
    f.write(content)
