import re

with open('bot.ts', 'r') as f:
    content = f.read()

# Find the end of processTick and getDiagnostics
content = re.sub(r'\}\s*\}\s*\}\s*public getDiagnostics\(\)', '    }\n  }\n\n  public getDiagnostics()', content)

with open('bot.ts', 'w') as f:
    f.write(content)
print("Updated regex in bot.ts")
