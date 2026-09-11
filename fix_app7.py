import re

with open('src/App.tsx', 'r') as f:
    content = f.read()

bad_block = """  useEffect(() => {
    if (geminiKey ||  const handleValidKey = (newGeminiKey: string, newGroqKey: string) => {
    setShowKeyModal(false);
    localStorage.setItem('gemini_api_key', newGeminiKey);
    localStorage.setItem('groq_api_key', newGroqKey);
    setGeminiKey(newGeminiKey);
    setGroqKey(newGroqKey);
    setIsKeyValid(true);
    fetchTrades();
  };"""

content = content.replace(bad_block, """  useEffect(() => {
    fetchTrades();
  }, [fetchTrades]);""")

# Also need to remove the remaining variables from handleReboot:
content = content.replace("      localStorage.removeItem('gemini_api_key');\n      localStorage.removeItem('groq_api_key');\n      setGeminiKey('');\n      setGroqKey('');\n      setIsKeyValid(false);\n", "")

with open('src/App.tsx', 'w') as f:
    f.write(content)
