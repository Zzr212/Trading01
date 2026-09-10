import re

with open('src/components/ApiKeyScreen.tsx', 'r') as f:
    content = f.read()

old_interface = """interface Props {
  onValidKey: (geminiKey: string, groqKey: string) => void;
}"""

new_interface = """interface Props {
  onValidKey: (geminiKey: string, groqKey: string) => void;
  onClose?: () => void;
  initialGemini?: string;
  initialGroq?: string;
}"""
content = content.replace(old_interface, new_interface)

old_comp = "export default function ApiKeyScreen({ onValidKey }: Props) {\n  const [geminiKey, setGeminiKey] = useState('');\n  const [groqKey, setGroqKey] = useState('');"
new_comp = "export default function ApiKeyScreen({ onValidKey, onClose, initialGemini = '', initialGroq = '' }: Props) {\n  const [geminiKey, setGeminiKey] = useState(initialGemini);\n  const [groqKey, setGroqKey] = useState(initialGroq);"
content = content.replace(old_comp, new_comp)

old_min_h = "className=\"min-h-screen bg-neutral-950 flex flex-col items-center justify-center p-4\""
new_min_h = "className=\"w-full max-w-md bg-neutral-900 border border-neutral-800 rounded-2xl p-8 flex flex-col gap-6 shadow-2xl relative\""
content = content.replace(old_min_h, new_min_h)
# Remove the wrapper div that makes it full screen, since we added the wrapper in App.tsx
content = content.replace("<div className=\"min-h-screen bg-neutral-950 flex flex-col items-center justify-center p-4\">\n      <div className=\"max-w-md w-full bg-neutral-900 border border-neutral-800 rounded-2xl p-8 flex flex-col gap-6 shadow-2xl\">", "<div className=\"w-full max-w-md bg-neutral-900 border border-neutral-800 rounded-2xl p-8 flex flex-col gap-6 shadow-2xl relative\">")
content = content.replace("</form>\n      </div>\n    </div>", "</form>\n    </div>")

# Add close button if onClose is provided
close_btn = """
        {onClose && (
          <button onClick={onClose} className="absolute top-4 right-4 text-neutral-500 hover:text-neutral-300">
            ✕
          </button>
        )}
"""
content = content.replace("<div className=\"w-12 h-12", close_btn + "\n        <div className=\"w-12 h-12")

# Allow saving even if empty? 
# "tamo kada unesem automatski provjeri jesul kvote upotrebljene i da li su kljucevi ispravni."
# "ako nije dostupan ni jedan model u active opciji na panelu blinka crveno svjetlo"
# The submit button should say Verify & Save.

content = content.replace("{isLoading ? 'Verifying...' : 'Start Trading'}", "{isLoading ? 'Verifying...' : 'Verify & Save'}")

with open('src/components/ApiKeyScreen.tsx', 'w') as f:
    f.write(content)
