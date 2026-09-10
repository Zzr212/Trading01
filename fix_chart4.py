with open('src/components/ChartContainer.tsx', 'r') as f:
    content = f.read()

bad_string = """import React, { useState, useEffect, useRef } from 'react';import { Kline, Timeframe, Trade, SRLevels } from '../types  const enrichedData = React.useMemo(() => {    if (data.length === 0) return [];    const ema9 = calculateEMA(data, 9);    const ema21 = calculateEMA(data, 21);    const rsiArray = calculateRSI(data, 14);    return data.map((d, i) => ({      ...d,      ema9: ema9[i],      ema21: ema21[i],      rsi: rsiArray[i]    }));  }, [data]);';"""

good_string = """import React, { useState, useEffect, useRef } from 'react';import { Kline, Timeframe, Trade, SRLevels } from '../types';"""

content = content.replace(bad_string, good_string)

enriched_block = """  const enrichedData = React.useMemo(() => {
    if (data.length === 0) return [];
    const ema9 = calculateEMA(data, 9);
    const ema21 = calculateEMA(data, 21);
    const rsiArray = calculateRSI(data, 14);
    return data.map((d, i) => ({
      ...d,
      ema9: ema9[i],
      ema21: ema21[i],
      rsi: rsiArray[i]
    }));
  }, [data]);\n"""

# Insert enriched_block after `const [data, setData] = useState<Kline[]>([]);`
insert_after = "const [data, setData] = useState<Kline[]>([]);"
content = content.replace(insert_after, insert_after + "\n" + enriched_block)

with open('src/components/ChartContainer.tsx', 'w') as f:
    f.write(content)
