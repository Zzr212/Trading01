import re

with open('src/App.tsx', 'r') as f:
    content = f.read()

# Remove the Top Header
top_header = r"      \{\/\* Top Header to go back \*\/\}.*?<\/div>"
content = re.sub(top_header, "", content, flags=re.DOTALL)

# Add onBack prop to ChartContainer
chart_container = r"<ChartContainer\s+symbol=\{pair\}"
content = re.sub(chart_container, "<ChartContainer \n          onBack={onBack}\n          symbol={pair}", content)

with open('src/App.tsx', 'w') as f:
    f.write(content)
