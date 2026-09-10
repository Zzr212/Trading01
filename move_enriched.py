import re

with open('src/components/ChartContainer.tsx', 'r') as f:
    content = f.read()

# Extract enrichedData block
enriched_regex = r"(  const enrichedData = React\.useMemo\(\(\) => \{[\s\S]*?    \}\);\n  \}\);\n)"
match = re.search(enriched_regex, content)
if match:
    enriched_block = match.group(1)
    # Remove from old position
    content = content.replace(enriched_block, "")
    
    # Insert after `const wsRef = useRef<WebSocket | null>(null);`
    target = "const wsRef = useRef<WebSocket | null>(null);\n"
    content = content.replace(target, target + "\n" + enriched_block + "\n")

with open('src/components/ChartContainer.tsx', 'w') as f:
    f.write(content)
