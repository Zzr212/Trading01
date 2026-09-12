import re

with open('src/components/Dashboard.tsx', 'r') as f:
    content = f.read()

# Make the outer container scrollable instead of fixed flex-col
old_outer = 'className="h-[100dvh] w-full bg-neutral-950 flex flex-col font-sans overflow-hidden text-white"'
new_outer = 'className="min-h-[100dvh] w-full bg-neutral-950 flex flex-col font-sans text-white"'
content = content.replace(old_outer, new_outer)

# Fix the Top 35% section for mobile
old_top = 'className="h-[35%] w-full border-b border-neutral-900 flex items-center p-6 bg-neutral-950 shadow-md z-10 relative"'
new_top = 'className="w-full border-b border-neutral-900 flex flex-col lg:flex-row items-center p-4 lg:p-8 bg-neutral-950/80 backdrop-blur-xl shadow-lg z-10 relative"'
content = content.replace(old_top, new_top)

# Fix the Donut chart container
old_donut = 'className="h-full w-1/3 flex items-center justify-center relative"'
new_donut = 'className="h-64 lg:h-80 w-full lg:w-1/3 flex items-center justify-center relative mb-6 lg:mb-0"'
content = content.replace(old_donut, new_donut)

# Fix the Pair Summary right side
old_right = 'className="h-full w-2/3 pl-8 flex items-center"'
new_right = 'className="w-full lg:w-2/3 lg:pl-10 flex items-center"'
content = content.replace(old_right, new_right)

# Fix the grid for Pair Summary
old_grid = 'className="grid grid-cols-3 gap-6 w-full"'
new_grid = 'className="grid grid-cols-2 md:grid-cols-3 gap-4 lg:gap-6 w-full"'
content = content.replace(old_grid, new_grid)

# Fix the Bottom section container
old_bottom = 'className="flex-1 w-full bg-neutral-950 overflow-y-auto p-6"'
new_bottom = 'className="flex-1 w-full max-w-7xl mx-auto bg-neutral-950 p-4 lg:p-8"'
content = content.replace(old_bottom, new_bottom)

# Enhance the Pair rows
old_pair_row = 'className="group flex items-center justify-between p-5 rounded-2xl bg-neutral-900 border border-neutral-800 hover:border-blue-500/50 cursor-pointer transition-all hover:bg-neutral-800/80 hover:shadow-[0_0_20px_rgba(59,130,246,0.1)]"'
new_pair_row = 'className="group flex flex-col sm:flex-row sm:items-center justify-between p-4 lg:p-5 rounded-2xl bg-neutral-900/60 border border-neutral-800 hover:border-blue-500/50 cursor-pointer transition-all hover:bg-neutral-800 hover:shadow-[0_8px_30px_rgba(59,130,246,0.1)]"'
content = content.replace(old_pair_row, new_pair_row)

# Fix inner spacing for Pair rows on mobile
old_pair_left = 'className="flex items-center gap-4"'
new_pair_left = 'className="flex items-center gap-4 mb-4 sm:mb-0"'
content = content.replace(old_pair_left, new_pair_left)

old_pair_right = 'className="flex items-center gap-12"'
new_pair_right = 'className="flex items-center justify-between sm:justify-end sm:gap-12 w-full sm:w-auto border-t sm:border-t-0 border-neutral-800/50 pt-4 sm:pt-0"'
content = content.replace(old_pair_right, new_pair_right)

with open('src/components/Dashboard.tsx', 'w') as f:
    f.write(content)
