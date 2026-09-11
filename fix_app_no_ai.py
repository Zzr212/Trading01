import re

with open('src/App.tsx', 'r') as f:
    content = f.read()

# Remove ApiKeyScreen import
content = re.sub(r"import ApiKeyScreen from '\./components/ApiKeyScreen';\n", "", content)

# Remove state variables
content = re.sub(r"  const \[geminiKey, setGeminiKey\].*\n", "", content)
content = re.sub(r"  const \[groqKey, setGroqKey\].*\n", "", content)
content = re.sub(r"  const \[isKeyValid, setIsKeyValid\].*\n", "", content)
content = re.sub(r"  const \[showKeyModal, setShowKeyModal\].*\n", "", content)

# Remove key validation logic
valid_key_func = r"  const handleValidKey =.*?\}\);\n  \};\n"
content = re.sub(valid_key_func, "", content, flags=re.DOTALL)

# Remove the useEffect that verifies keys on mount
use_effect = r"  useEffect\(\(\) => \{\n    let isMounted = true;\n    if \(geminiKey || groqKey\) \{.*?    \}\n  \}, \[geminiKey, groqKey, fetchTrades, addError\]\);\n"
content = re.sub(use_effect, "", content, flags=re.DOTALL)

# Now in the return, remove modal overlay and ApiKeyScreen
modal = r"      \{showKeyModal && \(\n        <div className=\"absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm\">\n          <ApiKeyScreen \n            onValidKey=\{handleValidKey\} \n            onClose=\{.*?\} \n            initialGemini=\{geminiKey\}\n            initialGroq=\{groqKey\}\n          />\n        </div>\n      \)\}\n"
content = re.sub(modal, "", content, flags=re.DOTALL)

# Update ChartContainer props
content = content.replace("          geminiKey={geminiKey}\n          groqKey={groqKey}\n", "")

# Update TradePanel props
content = content.replace("          aiAvailable={isKeyValid}\n          onOpenKeys={() => setShowKeyModal(true)}\n", "")

with open('src/App.tsx', 'w') as f:
    f.write(content)
