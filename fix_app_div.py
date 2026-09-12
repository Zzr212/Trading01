with open('src/App.tsx', 'r') as f:
    content = f.read()

content = content.replace('overflow-hidden relative">\n      </div>', 'overflow-hidden relative">')

with open('src/App.tsx', 'w') as f:
    f.write(content)
