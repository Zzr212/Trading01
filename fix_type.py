import re
with open('src/types.ts', 'r') as f:
    content = f.read()

content = content.replace('timestamp: number;\n  confidence: number;', 'timestamp: number;\n  closeTimestamp?: number;\n  confidence: number;')

with open('src/types.ts', 'w') as f:
    f.write(content)
