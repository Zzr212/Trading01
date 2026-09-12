with open('src/components/Dashboard.tsx', 'r') as f:
    content = f.read()

# 1. Imports
content = content.replace("import React, { useEffect, useState, useMemo } from 'react';",
                          "import React, { useEffect, useState, useMemo } from 'react';\nimport { Activity } from 'lucide-react';\nimport SystemDiagnosticsModal from './SystemDiagnosticsModal';")

# 2. State
content = content.replace("  const [prices, setPrices] = useState<Record<string, number>>({});",
                          "  const [prices, setPrices] = useState<Record<string, number>>({});\n  const [showDiagnostics, setShowDiagnostics] = useState<boolean>(false);")

# 3. Add Button to Top-Right
old_header_start = """      {/* Top 35% - Statistics */}
      <div className="w-full border-b border-neutral-900 flex flex-col lg:flex-row items-center p-4 lg:p-8 bg-neutral-950/80 backdrop-blur-xl shadow-lg z-10 relative">"""

new_header_start = """      {/* Top 35% - Statistics */}
      <div className="w-full border-b border-neutral-900 flex flex-col lg:flex-row items-center p-4 lg:p-8 bg-neutral-950/80 backdrop-blur-xl shadow-lg z-10 relative">
        {/* Top-Right System Diagnostics Trigger */}
        <div className="absolute top-4 right-4 z-20">
          <button
            onClick={() => setShowDiagnostics(true)}
            className="flex items-center gap-2 px-3 py-1.5 rounded-xl bg-neutral-900/90 hover:bg-neutral-800 border border-neutral-800 hover:border-neutral-700 text-neutral-300 hover:text-white transition-all text-xs font-medium shadow-lg group backdrop-blur-md cursor-pointer"
            title="Sistemska provjera rada svih komponenti bota i AI modela"
          >
            <span className="relative flex h-2 w-2">
              <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
              <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
            </span>
            <Activity size={14} className="text-neutral-400 group-hover:text-emerald-400 transition-colors" />
            <span className="font-mono text-[11px] tracking-wide hidden sm:inline">SYSTEM DIAGNOSTICS</span>
            <span className="font-mono text-[11px] tracking-wide sm:hidden">SYSTEM</span>
          </button>
        </div>"""

content = content.replace(old_header_start, new_header_start)

# 4. Add Modal at the end of the return statement
content = content.replace("    </div>\n  );\n}", """      {/* Diagnostics Modal */}
      <SystemDiagnosticsModal
        isOpen={showDiagnostics}
        onClose={() => setShowDiagnostics(false)}
      />
    </div>
  );
}""")

with open('src/components/Dashboard.tsx', 'w') as f:
    f.write(content)
print("Dashboard.tsx updated with SystemDiagnostics button and modal")
