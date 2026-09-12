import re
with open('src/components/Dashboard.tsx', 'r') as f:
    content = f.read()

# Disable Pie animation
content = content.replace('<Pie\n                data={displayDonutData}', '<Pie\n                isAnimationActive={false}\n                data={displayDonutData}')

# Add active indicator
# Find this in the pair list mapping:
# <div className="text-xl font-bold tracking-tight">{pair}</div>
# and replace with:
# <div className="flex items-center gap-2">\n  <div className="text-xl font-bold tracking-tight">{pair}</div>\n  {pStats.active > 0 && <span className="relative flex h-3 w-3"><span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span><span className="relative inline-flex rounded-full h-3 w-3 bg-emerald-500"></span></span>}\n</div>

old_pair_name = '<div className="text-xl font-bold tracking-tight">{pair}</div>'
new_pair_name = '''<div className="flex items-center gap-2">
                       <div className="text-xl font-bold tracking-tight">{pair}</div>
                       {pStats.active > 0 && (
                         <div className="relative flex h-2.5 w-2.5" title="Active Trade Running">
                           <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                           <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-500"></span>
                         </div>
                       )}
                     </div>'''

content = content.replace(old_pair_name, new_pair_name)

with open('src/components/Dashboard.tsx', 'w') as f:
    f.write(content)
