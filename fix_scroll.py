import re

with open('src/components/Dashboard.tsx', 'r') as f:
    content = f.read()

# Make the dashboard scrollable
old_root = 'className="min-h-[100dvh] w-full bg-neutral-950 flex flex-col font-sans text-white"'
new_root = 'className="h-[100dvh] w-full bg-neutral-950 flex flex-col font-sans text-white overflow-y-auto"'

content = content.replace(old_root, new_root)

with open('src/components/Dashboard.tsx', 'w') as f:
    f.write(content)
