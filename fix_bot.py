import re

with open('bot.ts', 'r') as f:
    content = f.read()

content = content.replace("this.init();", "")

content = content.replace("private async init() {", "public async start() {")

with open('bot.ts', 'w') as f:
    f.write(content)
