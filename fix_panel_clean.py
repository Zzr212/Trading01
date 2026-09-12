import re

with open('src/components/TradePanel.tsx', 'r') as f:
    content = f.read()

# 1. Update TabType
content = re.sub(r"type TabType = [^;]+;", "type TabType = 'ACTIVE' | 'HISTORY' | 'ORDER BOOK' | 'ERRORS';", content)

# 2. Add OrderBook import if not present
if "import OrderBook from './OrderBook';" not in content:
    content = content.replace("import TradeReplayModal from './TradeReplayModal';", "import TradeReplayModal from './TradeReplayModal';\nimport OrderBook from './OrderBook';")

# 3. Add ORDER BOOK to tab list
content = content.replace("{(['ACTIVE', 'HISTORY'] as const).map(tab => (", "{(['ACTIVE', 'HISTORY', 'ORDER BOOK'] as const).map(tab => (")

# 4. Add ORDER BOOK render block before </AnimatePresence>
ob_block = """          {activeTab === 'ORDER BOOK' && (
            <motion.div key="orderbook-view" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="h-64 sm:h-full">
              <OrderBook symbol={activePair} />
            </motion.div>
          )}
        </AnimatePresence>"""

if "{activeTab === 'ORDER BOOK' && (" not in content:
    content = content.replace("</AnimatePresence>", ob_block)

with open('src/components/TradePanel.tsx', 'w') as f:
    f.write(content)
print("TradePanel updated successfully")
