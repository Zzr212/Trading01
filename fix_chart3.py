import re

with open('src/components/ChartContainer.tsx', 'r') as f:
    content = f.read()

content = content.replace("apiKey: string;", "geminiKey: string;\n  groqKey: string;")
content = content.replace("apiKey, activeTrade", "geminiKey, groqKey, activeTrade")
content = content.replace("if (!apiKey) return;", "if (!geminiKey && !groqKey) return;")
content = content.replace("'Authorization': `Bearer ${apiKey}`", "'x-gemini-key': geminiKey,\n          'x-groq-key': groqKey")
content = content.replace("apiKey, onError", "geminiKey, groqKey, onError")
content = content.replace("apiKey, srLevels", "geminiKey, groqKey, srLevels")

with open('src/components/ChartContainer.tsx', 'w') as f:
    f.write(content)
