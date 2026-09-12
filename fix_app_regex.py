import re
with open('src/App.tsx', 'r') as f:
    content = f.read()

content = re.sub(r'<div className="h-\[100dvh\] w-full flex flex-col bg-neutral-950 font-sans selection:bg-blue-500\/30 overflow-hidden relative">\s*<\/div>', '<div className="h-[100dvh] w-full flex flex-col bg-neutral-950 font-sans selection:bg-blue-500/30 overflow-hidden relative">', content)

with open('src/App.tsx', 'w') as f:
    f.write(content)
