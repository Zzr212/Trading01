import re

with open('src/components/TradeReplayModal.tsx', 'r') as f:
    content = f.read()

# Add createPortal import
content = content.replace("import React, { useEffect, useState, useRef, useCallback } from 'react';", "import React, { useEffect, useState, useRef, useCallback } from 'react';\nimport { createPortal } from 'react-dom';")

# Change return statement
content = content.replace("  return (\n    <div className=\"fixed inset-0 z-50 bg-neutral-950 flex flex-col\">", "  const modalContent = (\n    <div className=\"fixed inset-0 z-[100] bg-neutral-950 flex flex-col\">")

# Change closing return
content = content.replace("    </div>\n  );\n}", "    </div>\n  );\n\n  return createPortal(modalContent, document.body);\n}")

with open('src/components/TradeReplayModal.tsx', 'w') as f:
    f.write(content)
