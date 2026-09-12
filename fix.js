const fs = require('fs');
let code = fs.readFileSync('src/App.tsx', 'utf8');
code = code.replace(/<div className="h-\[100dvh\].*?relative">\s*<\/div>/, '<div className="h-[100dvh] w-full flex flex-col bg-neutral-950 font-sans selection:bg-blue-500/30 overflow-hidden relative">');
fs.writeFileSync('src/App.tsx', code);
