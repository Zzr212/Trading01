import re

with open('src/components/ApiKeyScreen.tsx', 'r') as f:
    content = f.read()

content = content.replace('    <div className="w-full max-w-md bg-neutral-900 border border-neutral-800 rounded-2xl p-8 flex flex-col gap-6 shadow-2xl relative">\n      <div className="max-w-md w-full bg-neutral-900 border border-neutral-800 rounded-2xl p-8 flex flex-col gap-6 shadow-2xl">', '    <div className="w-full max-w-md bg-neutral-900 border border-neutral-800 rounded-2xl p-8 flex flex-col gap-6 shadow-2xl relative">')

with open('src/components/ApiKeyScreen.tsx', 'w') as f:
    f.write(content)
