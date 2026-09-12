with open('bot.ts', 'r') as f:
    content = f.read()

diag_code = """
  public getDiagnostics() {
    const wsConnected = !!this.ws && this.ws.readyState === WebSocket.OPEN;
    const activeTradesList = Object.entries(this.activeTrades)
      .filter(([_, t]) => t !== null)
      .map(([pair, t]) => ({ pair, type: t!.type, entryPrice: t!.entryPrice }));

    return {
      botStatus: 'ONLINE',
      wsStatus: wsConnected ? 'CONNECTED' : 'CONNECTING',
      monitoredPairs: PAIRS,
      activeTradesCount: activeTradesList.length,
      activeTrades: activeTradesList,
      fundingRates: this.fundingRates,
      orderBookImbalances: this.obImbalances,
      aiModel: this.predictor.getStatus(),
      uptimeSeconds: Math.floor(process.uptime()),
      heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024)
    };
  }
}"""

# Replace the closing brace of TradingBot
content = content[:-1] + diag_code

with open('bot.ts', 'w') as f:
    f.write(content)
print("bot.ts updated with getDiagnostics")
