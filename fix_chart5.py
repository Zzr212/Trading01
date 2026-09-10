import re

with open('src/components/ChartContainer.tsx', 'r') as f:
    content = f.read()

# Replace the messy first line with a clean import
content = re.sub(
    r"import React, { useState, useEffect, useRef } from 'react';import { Kline, Timeframe, Trade, SRLevels } from '\.\./types  const enrichedData = React\.useMemo\(\(\) => \{.*?  \}, \[data\]\);';",
    "import React, { useState, useEffect, useRef } from 'react';\nimport { Kline, Timeframe, Trade, SRLevels } from '../types';",
    content,
    flags=re.DOTALL
)

with open('src/components/ChartContainer.tsx', 'w') as f:
    f.write(content)
