import re

with open('src/components/ChartContainer.tsx', 'r') as f:
    content = f.read()

start_index = content.find("  const enrichedData = React.useMemo(() => {")
end_index = content.find("  }, [data]);\n", start_index) + len("  }, [data]);\n")

if start_index != -1 and end_index != -1:
    enriched_block = content[start_index:end_index]
    content = content[:start_index] + content[end_index:]
    
    insert_after = "const [srLevels, setSrLevels] = useState<{supports: number[], resistances: number[]}>({supports: [], resistances: []});\n"
    insert_pos = content.find(insert_after) + len(insert_after)
    
    content = content[:insert_pos] + "\n" + enriched_block + content[insert_pos:]
    
    with open('src/components/ChartContainer.tsx', 'w') as f:
        f.write(content)
else:
    print("Block not found")
