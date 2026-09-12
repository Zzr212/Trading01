import re

with open('src/components/ChartContainer.tsx', 'r') as f:
    content = f.read()

# Update Props
content = content.replace("interface Props {", "interface Props {\n  symbol: string;")

# Update initial fetch in ChartContainer
content = content.replace("'BTCUSDT', timeframe, 1000", "symbol, timeframe, 1000")
content = content.replace("'BTCUSDT', '15m', 100)", "symbol, '15m', 100)")
content = content.replace("'BTCUSDT', timeframe, 1000, currentEarliest - 1)", "symbol, timeframe, 1000, currentEarliest - 1)")

# Update WS connection
content = content.replace("wss://stream.binance.com:9443/ws/btcusdt@kline_${timeframe}", "wss://stream.binance.com:9443/ws/${symbol.toLowerCase()}@kline_${timeframe}")

# Ensure we use `symbol` in dependencies for useEffects
# For the main data fetch:
effect1 = r"  }, \[timeframe, onError\]\);"
content = re.sub(effect1, "  }, [timeframe, onError, symbol]);", content)

# For the websocket:
effect2 = r"  }, \[timeframe, analyzingRef\]\);"
content = re.sub(effect2, "  }, [timeframe, analyzingRef, symbol]);", content)

# Remove the 'btcusdt' string hardcode if any other left
# Let's replace 'BTCUSDT' with symbol in any remaining places (except imports)
# It's cleaner to just do that manually if needed

with open('src/components/ChartContainer.tsx', 'w') as f:
    f.write(content)
