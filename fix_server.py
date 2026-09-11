import re

with open('server.ts', 'r') as f:
    content = f.read()

# Add import
import_stmt = "import { TradingBot } from './bot';\n"
content = content.replace('import { createServer as createViteServer } from "vite";', 'import { createServer as createViteServer } from "vite";\n' + import_stmt)

# Start bot
start_server = "async function startServer() {"
start_bot = """async function startServer() {
  const bot = new TradingBot(db);
  bot.start();
"""
content = content.replace(start_server, start_bot)

with open('server.ts', 'w') as f:
    f.write(content)
