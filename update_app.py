import re

with open('src/App.tsx', 'r') as f:
    content = f.read()

# Replace apiKey state with geminiKey and groqKey
content = content.replace("const [apiKey, setApiKey] = useState<string>(localStorage.getItem('gemini_api_key') || '');", 
"const [geminiKey, setGeminiKey] = useState<string>(localStorage.getItem('gemini_api_key') || '');\n  const [groqKey, setGroqKey] = useState<string>(localStorage.getItem('groq_api_key') || '');")

# Replace handleReboot internals
content = content.replace("localStorage.removeItem('gemini_api_key');\n      setApiKey('');", 
"localStorage.removeItem('gemini_api_key');\n      localStorage.removeItem('groq_api_key');\n      setGeminiKey('');\n      setGroqKey('');")

# Update useEffect for key verification
old_use_effect = """  useEffect(() => {
    if (apiKey) {
      fetch('/api/verify-key', {
        method: 'POST',
        headers: { 'Authorization': `Bearer ${apiKey}` }
      })
      .then(r => r.json())
      .then(d => {
        if (d.valid) {
          setIsKeyValid(true);
          fetchTrades();
        } else {
          localStorage.removeItem('gemini_api_key');
          setApiKey('');
          addError("API Key validation failed. Please re-enter.");
        }
      })
      .catch(e => addError("Network error validating API key"));
    }
  }, [apiKey, fetchTrades, addError]);"""

new_use_effect = """  useEffect(() => {
    if (geminiKey || groqKey) {
      fetch('/api/verify-key', {
        method: 'POST',
        headers: { 
          'x-gemini-key': geminiKey,
          'x-groq-key': groqKey
        }
      })
      .then(r => r.json())
      .then(d => {
        if (d.valid) {
          setIsKeyValid(true);
          fetchTrades();
        } else {
          localStorage.removeItem('gemini_api_key');
          localStorage.removeItem('groq_api_key');
          setGeminiKey('');
          setGroqKey('');
          addError("API Key validation failed. Please re-enter.");
        }
      })
      .catch(e => addError("Network error validating API keys"));
    }
  }, [geminiKey, groqKey, fetchTrades, addError]);"""

content = content.replace(old_use_effect, new_use_effect)

# Update handleValidKey
old_handle_key = """  const handleValidKey = (key: string) => {
    localStorage.setItem('gemini_api_key', key);
    setApiKey(key);
    setIsKeyValid(true);
    fetchTrades();
  };"""

new_handle_key = """  const handleValidKey = (newGeminiKey: string, newGroqKey: string) => {
    localStorage.setItem('gemini_api_key', newGeminiKey);
    localStorage.setItem('groq_api_key', newGroqKey);
    setGeminiKey(newGeminiKey);
    setGroqKey(newGroqKey);
    setIsKeyValid(true);
    fetchTrades();
  };"""

content = content.replace(old_handle_key, new_handle_key)

with open('src/App.tsx', 'w') as f:
    f.write(content)
