import re

with open('src/components/TradePanel.tsx', 'r') as f:
    content = f.read()

content = content.replace("type TabType = 'ACTIVE' | 'HISTORY' | 'ERRORS';", "type TabType = 'ACTIVE' | 'HISTORY' | 'ERRORS' | 'ORDER BOOK';")
content = content.replace("import TradeReplayModal from './TradeReplayModal';", "import TradeReplayModal from './TradeReplayModal';\nimport OrderBook from './OrderBook';")

# Find the tab buttons map
old_tabs = """            {['ACTIVE', 'HISTORY', 'ERRORS'].map(tab => ("""
new_tabs = """            {['ACTIVE', 'HISTORY', 'ERRORS', 'ORDER BOOK'].map(tab => ("""
content = content.replace(old_tabs, new_tabs)

# We need to pass down the active pair to TradePanel so OrderBook knows which symbol to use.
# But wait, TradePanel doesn't have `activePair`. Let's check `src/App.tsx` how TradePanel is called.
