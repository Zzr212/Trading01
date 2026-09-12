import re

with open('src/App.tsx', 'r') as f:
    content = f.read()

# I will just write out the header properly.
header_old = """      {/* Top Header to go back */}
      <div className="absolute top-4 left-4 z-50">
        <button 
          onClick={onBack}
          className="flex items-center gap-2 bg-neutral-900/80 hover:bg-neutral-800 text-white px-4 py-2 rounded-full backdrop-blur-sm border border-neutral-800 transition-colors shadow-lg"
        >
          <ArrowLeft size={16} />
          <span className="text-sm font-bold">Back</span></button><div className="ml-4 px-4 py-2 bg-neutral-900/80 rounded-full border border-neutral-800 text-white font-bold backdrop-blur-sm shadow-lg">{pair} - Trading View</div>
        </button>
      </div>"""

header_new = """      {/* Top Header to go back */}
      <div className="absolute top-4 left-4 z-50 flex items-center gap-4">
        <button 
          onClick={onBack}
          className="flex items-center gap-2 bg-neutral-900/80 hover:bg-neutral-800 text-white px-4 py-2 rounded-full backdrop-blur-sm border border-neutral-800 transition-colors shadow-lg"
        >
          <ArrowLeft size={16} />
          <span className="text-sm font-bold">Back</span>
        </button>
        <div className="px-4 py-2 bg-neutral-900/80 rounded-full border border-neutral-800 text-white font-bold backdrop-blur-sm shadow-lg">
          {pair} - Trading View
        </div>
      </div>"""

content = content.replace(header_old, header_new)

with open('src/App.tsx', 'w') as f:
    f.write(content)
