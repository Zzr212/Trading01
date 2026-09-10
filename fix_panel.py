import re

with open('src/components/TradePanel.tsx', 'r') as f:
    content = f.read()

# Add to interface
old_interface = """interface Props {
  activeTrade: Trade | null;"""

new_interface = """interface Props {
  aiAvailable?: boolean;
  onOpenKeys?: () => void;
  activeTrade: Trade | null;"""
content = content.replace(old_interface, new_interface)

# Add to signature
content = content.replace("export default function TradePanel({ activeTrade, history, sentimentScore, errors, onClearErrors, activeTab, setActiveTab, onReboot }: Props) {", "export default function TradePanel({ aiAvailable, onOpenKeys, activeTrade, history, sentimentScore, errors, onClearErrors, activeTab, setActiveTab, onReboot }: Props) {")

# Add Key button next to Reboot button
old_reboot = """<button 
          onClick={onReboot}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-neutral-800 text-neutral-400 hover:bg-neutral-700 hover:text-white transition-colors"
          title="Hard Reset System"
        >
          <Power size={14} />
          Reboot
        </button>"""

new_reboot = """
        <button 
          onClick={onOpenKeys}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-blue-500/10 text-blue-400 hover:bg-blue-500/20 transition-colors"
          title="API Keys"
        >
          <KeyRound size={14} />
          Keys
        </button>
        <button 
          onClick={onReboot}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold bg-neutral-800 text-neutral-400 hover:bg-neutral-700 hover:text-white transition-colors"
          title="Hard Reset System"
        >
          <Power size={14} />
          Reboot
        </button>"""
content = content.replace(old_reboot, new_reboot)

# Make sure KeyRound is imported
if "KeyRound" not in content:
    content = content.replace("Power,", "Power, KeyRound,")

# Add blinking red light if not aiAvailable to the ACTIVE tab title or active panel
# In activeTab === 'ACTIVE' rendering:
old_active = """<div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Zap size={20} className="text-blue-500" />
              Active Signal
            </h2>"""

new_active = """<div className="flex justify-between items-center mb-6">
            <h2 className="text-xl font-bold text-white flex items-center gap-2">
              <Zap size={20} className="text-blue-500" />
              Active Signal
              {aiAvailable === false && (
                <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wider font-bold text-red-500 bg-red-500/10 px-2 py-0.5 rounded-full ml-2">
                  <div className="w-1.5 h-1.5 rounded-full bg-red-500 animate-pulse" />
                  AI Offline
                </span>
              )}
            </h2>"""
content = content.replace(old_active, new_active)

with open('src/components/TradePanel.tsx', 'w') as f:
    f.write(content)
