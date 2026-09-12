import re
with open('bot.ts', 'r') as f:
    content = f.read()

# Update INSERT trades
old_insert = 'INSERT INTO trades VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
new_insert = 'INSERT INTO trades (id, pair, type, entryPrice, takeProfit, stopLoss, status, timestamp, confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)'
content = content.replace(old_insert, new_insert)

# Update UPDATE trades
old_update = 'const updateStmt = this.db.prepare("UPDATE trades SET status = ? WHERE id = ?");\n        updateStmt.run(result, activeTrade.id);'
new_update = 'const updateStmt = this.db.prepare("UPDATE trades SET status = ?, closeTimestamp = ? WHERE id = ?");\n        updateStmt.run(result, Date.now(), activeTrade.id);'
content = content.replace(old_update, new_update)

with open('bot.ts', 'w') as f:
    f.write(content)
