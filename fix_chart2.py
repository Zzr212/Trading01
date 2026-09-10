import re

with open('src/components/ChartContainer.tsx', 'r') as f:
    content = f.read()

# Fix the /api/analyze header
old_analyze = """      fetch('/api/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${apiKey}`
        },"""

new_analyze = """      fetch('/api/analyze', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-gemini-key': geminiKey,
          'x-groq-key': groqKey
        },"""

content = content.replace(old_analyze, new_analyze)

# We still have `apiKey` inside ChartContainer? Wait! I replaced it with geminiKey and groqKey in the previous script but let me check if there's any stray `apiKey` variable.
# Let me replace `apiKey` with `geminiKey` just in case I missed it in the component body.
content = content.replace("apiKey, onError", "geminiKey, groqKey, onError")
# But wait, did I successfully replace `interface Props { apiKey... }`? Let's check `ChartContainer.tsx`.
