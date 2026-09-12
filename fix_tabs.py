import re

with open('src/App.tsx', 'r') as f:
    content = f.read()

content = content.replace("type TabType = 'ACTIVE' | 'HISTORY' | 'ERRORS';", "type TabType = 'ACTIVE' | 'HISTORY' | 'ERRORS' | 'ORDER BOOK';")

with open('src/App.tsx', 'w') as f:
    f.write(content)
