import re
with open('server.ts', 'r') as f:
    content = f.read()

# Update schema
old_schema = '''db.exec(`CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY,
  pair TEXT,
  type TEXT,
  entryPrice REAL,
  takeProfit REAL,
  stopLoss REAL,
  status TEXT,
  timestamp INTEGER,
  confidence INTEGER
)`);'''

new_schema = '''db.exec(`CREATE TABLE IF NOT EXISTS trades (
  id TEXT PRIMARY KEY,
  pair TEXT,
  type TEXT,
  entryPrice REAL,
  takeProfit REAL,
  stopLoss REAL,
  status TEXT,
  timestamp INTEGER,
  closeTimestamp INTEGER,
  confidence INTEGER
)`);

try {
  db.exec("ALTER TABLE trades ADD COLUMN closeTimestamp INTEGER;");
} catch(e) {}'''

content = content.replace(old_schema, new_schema)

with open('server.ts', 'w') as f:
    f.write(content)
