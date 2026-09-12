with open('src/App.tsx', 'r') as f:
    content = f.read()

content = content.replace('<div className="h-[100dvh] w-full flex flex-col bg-neutral-950 font-sans selection:bg-blue-500/30 overflow-hidden relative">\n      </div>\n      {/* Top Half - Chart (Dynamically sized) */}', '<div className="h-[100dvh] w-full flex flex-col bg-neutral-950 font-sans selection:bg-blue-500/30 overflow-hidden relative">\n      {/* Top Half - Chart (Dynamically sized) */}')

with open('src/App.tsx', 'w') as f:
    f.write(content)
