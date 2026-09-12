const PAIRS = ['BTCUSDT', 'ETHUSDT', 'SOLUSDT', 'XRPUSDT', 'EURUSDT', 'PAXGUSDT'];
const streams = PAIRS.map(p => `${p.toLowerCase()}@kline_5m/${p.toLowerCase()}@kline_15m`).join('/');
console.log(`wss://stream.binance.com:9443/stream?streams=${streams}`);
