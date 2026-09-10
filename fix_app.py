import re

with open('src/App.tsx', 'r') as f:
    content = f.read()

# Add new states
content = content.replace("const [isKeyValid, setIsKeyValid] = useState<boolean>(false);", 
"const [isKeyValid, setIsKeyValid] = useState<boolean>(false);\n  const [showKeyModal, setShowKeyModal] = useState<boolean>(!localStorage.getItem('gemini_api_key') && !localStorage.getItem('groq_api_key'));")

# Add function to handle closing modal
content = content.replace("const handleValidKey = (newGeminiKey: string, newGroqKey: string) => {",
"""const handleValidKey = (newGeminiKey: string, newGroqKey: string) => {
    setShowKeyModal(false);""")

# Update verification catch
content = content.replace("addError(\"API Key validation failed. Please re-enter.\");", "addError(\"API validation failed.\");")

# Pass props to TradePanel
content = content.replace("<TradePanel \n          activeTrade={activeTrade}",
"""<TradePanel 
          aiAvailable={isKeyValid}
          onOpenKeys={() => setShowKeyModal(true)}
          activeTrade={activeTrade}""")

# Render modal instead of blocking
block_code = """  if (!isKeyValid && !showKeyModal) {
    // Wait, let's just find the block if it exists
  }"""

# Actually, replace the existing blocking return
old_block = """  if (!isKeyValid) {
    return <ApiKeyScreen onValidKey={handleValidKey} />;
  }"""

content = content.replace(old_block, "")

# Add modal overlay
old_return = """  return (
    <div className="h-[100dvh] w-full flex flex-col bg-neutral-950 font-sans selection:bg-blue-500/30 overflow-hidden">"""

new_return = """  return (
    <div className="h-[100dvh] w-full flex flex-col bg-neutral-950 font-sans selection:bg-blue-500/30 overflow-hidden relative">
      {showKeyModal && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm">
          <ApiKeyScreen 
            onValidKey={handleValidKey} 
            onClose={() => setShowKeyModal(false)} 
            initialGemini={geminiKey}
            initialGroq={groqKey}
          />
        </div>
      )}"""

content = content.replace(old_return, new_return)

with open('src/App.tsx', 'w') as f:
    f.write(content)
