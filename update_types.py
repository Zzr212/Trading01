with open('src/types.ts', 'r') as f:
    content = f.read()

content = content.replace('confidence: number;', 'confidence: number;\n  aiFeatures?: number[];')

with open('src/types.ts', 'w') as f:
    f.write(content)
