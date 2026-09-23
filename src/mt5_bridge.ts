export interface MT5Config {
  enabled: boolean;
  serverUrl: string;
  magicNumber: number;
  slippagePoints: number;
  lotSizes: Record<string, number>;
  symbolMappings: Record<string, string>;
}

export interface MT5Heartbeat {
  timestamp: number;
  accountNumber?: string;
  broker?: string;
  balance?: number;
  equity?: number;
  margin?: number;
  freeMargin?: number;
  openPositionsCount?: number;
  openTickets?: number[];
  lastError?: string;
}

export const DEFAULT_MT5_CONFIG: MT5Config = {
  enabled: true,
  serverUrl: "http://92.5.176.43",
  magicNumber: 889900,
  slippagePoints: 50,
  lotSizes: {
    "BTCUSD": 0.01,
    "ETHUSD": 0.05,
    "XAUUSD": 0.02,
    "EURUSD": 0.10,
    "GBPUSD": 0.10,
    "SOLUSD": 0.50
  },
  symbolMappings: {
    "BTCUSD": "BTCUSD",
    "ETHUSD": "ETHUSD",
    "XAUUSD": "XAUUSD",
    "EURUSD": "EURUSD",
    "GBPUSD": "GBPUSD",
    "SOLUSD": "SOLUSD"
  }
};

export function generateMql5EACode(serverBaseUrl: string): string {
  let cleanUrl = (serverBaseUrl || "http://92.5.176.43").trim().replace(/\/$/, "");
  // Replace legacy port 3000 on Oracle IP with clean port 80 URL for MT5 WebRequest compatibility
  if (cleanUrl.includes("92.5.176.43:3000")) {
    cleanUrl = "http://92.5.176.43";
  }
  return `//+------------------------------------------------------------------+
//|                                           AITrader_MT5_Bridge.mq5 |
//|                             Copyright 2026, AI Trading System     |
//|                            Realtime Algo Execution for Vantage    |
//+------------------------------------------------------------------+
#property copyright "AI Trading Bot"
#property link      "${cleanUrl}"
#property version   "2.50"
#property strict

#include <Trade/Trade.mqh>

//--- Input Parameters
input group "=== Server Bridge Connection ==="
input string InpServerUrl       = "${cleanUrl}"; // Server Web API URL (Standardni Port 80, Bez kose crte na kraju)
input int    InpTimerSeconds    = 1;                     // Polling Interval (sekunde)
input ulong  InpMagicNumber     = 889900;                // Magic Number za pozicije
input ulong  InpDeviation       = 50;                    // Maksimalno odstupanje / Slippage (poena)

input group "=== Risk & Execution Controls ==="
input bool   InpAutoLotsFromServer = true;               // Koristi veličinu lota definisanu u Web App
input double InpFallbackLot        = 0.01;               // Podrazumevani Lot ako nije podešen u App

input group "=== Spread Filter & Slippage Guard ==="
input bool   InpEnableSpreadFilter = true;               // Aktiviraj Zaštitu od visokog spreada
input double InpMaxSpreadForex     = 3.0;                // Max Spread Forex (u pipovima, npr. EURUSD max 3.0)
input double InpMaxSpreadGold      = 60.0;               // Max Spread Zlato (u poenima / cents)
input double InpMaxSpreadCrypto    = 500.0;              // Max Spread Kripto (u poenima)

//--- Global Variables
CTrade         ExtTrade;
datetime       ExtLastHeartbeat = 0;
datetime       ExtLastKlinesSent = 0;
string         ExtActiveTradeIds[];
string         gServerUrl = "";

// Forward declarations
void SendHeartbeat();
void PollSignalsFromServer();
void ProcessServerOrders(string json);
void PushKlinesToServer();
void PushTickToServer();

string CleanServerUrl(string u)
{
   while(StringLen(u) > 0 && StringSubstr(u, StringLen(u) - 1, 1) == "/")
   {
      u = StringSubstr(u, 0, StringLen(u) - 1);
   }
   int apiPos = StringFind(u, "/api");
   if(apiPos > 0)
   {
      u = StringSubstr(u, 0, apiPos);
   }
   while(StringLen(u) > 0 && StringSubstr(u, StringLen(u) - 1, 1) == "/")
   {
      u = StringSubstr(u, 0, StringLen(u) - 1);
   }
   return u;
}

//+------------------------------------------------------------------+
//| Expert initialization function                                   |
//+------------------------------------------------------------------+
int OnInit()
{
   ExtTrade.SetExpertMagicNumber(InpMagicNumber);
   ExtTrade.SetDeviationInPoints(InpDeviation);
   ExtTrade.SetTypeFilling(ORDER_FILLING_IOC);
   
   gServerUrl = CleanServerUrl(InpServerUrl);
   Print(">>> [AI Trader MT5 Bridge v3.0] Pokrenut. Vantage terminal -> Node.js bot.");
   Print(">>> Server URL: ", gServerUrl);
   Print(">>> Proverite da li je u MT5: Tools -> Options -> Expert Advisors -> 'Allow WebRequest' dodat URL: ", gServerUrl);
   
   EventSetTimer(InpTimerSeconds);
   SendHeartbeat();
   PushKlinesToServer();
   return(INIT_SUCCEEDED);
}

//+------------------------------------------------------------------+
//| Expert deinitialization function                                 |
//+------------------------------------------------------------------+
void OnDeinit(const int reason)
{
   EventKillTimer();
   Print(">>> [AI Trader MT5 Bridge] Zaustavljen. Reason code: ", reason);
}

//+------------------------------------------------------------------+
//| Tick event function - real-time tick streaming                   |
//+------------------------------------------------------------------+
void OnTick()
{
   PushTickToServer();
}

//+------------------------------------------------------------------+
//| Timer event function - poziva se svake 1-2 sekunde               |
//+------------------------------------------------------------------+
void OnTimer()
{
   PollSignalsFromServer();
   
   // Pošalji heartbeat svakih 5 sekundi
   if(TimeCurrent() - ExtLastHeartbeat >= 5)
   {
      SendHeartbeat();
      ExtLastHeartbeat = TimeCurrent();
   }

   // Pošalji 5m/15m klines svakih 15 sekundi ili na zatvaranju sveće
   if(TimeCurrent() - ExtLastKlinesSent >= 15)
   {
      PushKlinesToServer();
      ExtLastKlinesSent = TimeCurrent();
   }
}


//+------------------------------------------------------------------+
//| HTTP GET helper funkcija                                         |
//+------------------------------------------------------------------+
bool HttpGet(string url, string &responseOut)
{
   char postData[];
   char resultData[];
   string resultHeaders;
   string headers = "Accept: application/json\\r\\nUser-Agent: MT5-AITrader/2.2\\r\\n";
   
   ResetLastError();
   int res = WebRequest("GET", url, headers, 4000, postData, resultData, resultHeaders);
   
   if(res == -1)
   {
      int err = GetLastError();
      if(err == 4014) // ERR_WEBREQUEST_INVALID_ADDRESS
      {
         Print(">>> [MT5 Error 4014] URL nije dodat u 'Allowed WebRequest URLs' u MT5!");
         Print(">>> Otvorite Tools -> Options -> Expert Advisors i dodajte URL: ", gServerUrl);
      }
      else
      {
         Print(">>> [MT5 WebRequest GET Error] Kod greške: ", err, " na URL: ", url);
      }
      return false;
   }
   
   if(res == 200 || res == 201)
   {
      responseOut = CharArrayToString(resultData, 0, WHOLE_ARRAY, CP_UTF8);
      return true;
   }
   
   Print(">>> [Server HTTP Response GET] Status kod: ", res, " za URL: ", url);
   if(res == 404)
   {
      Print(">>> [PAŽNJA 404] URL servera ne postoji ili nije aktivan. Proverite URL u InpServerUrl i 'Tools -> Options -> Expert Advisors'!");
   }
   return false;
}

//+------------------------------------------------------------------+
//| HTTP POST helper funkcija sa bezbednim uklanjanjem null bajta    |
//+------------------------------------------------------------------+
bool HttpPost(string url, string jsonBody, string &responseOut)
{
   char postData[];
   char resultData[];
   string resultHeaders;
   string headers = "Content-Type: application/json\\r\\nAccept: application/json\\r\\nUser-Agent: MT5-AITrader/2.2\\r\\n";
   
   // Kopiraj u UTF-8 i odseci završni \\0 null-terminator kako Express ne bi vratio 400 Bad Request
   int copied = StringToCharArray(jsonBody, postData, 0, WHOLE_ARRAY, CP_UTF8);
   if(copied > 0 && postData[copied - 1] == 0)
   {
      ArrayResize(postData, copied - 1);
   }
   
   ResetLastError();
   int res = WebRequest("POST", url, headers, 4000, postData, resultData, resultHeaders);
   if(res == -1)
   {
      int err = GetLastError();
      if(err == 4014)
      {
         Print(">>> [MT5 Error 4014] URL nije dodat u 'Allowed WebRequest URLs' u MT5!");
         Print(">>> Otvorite Tools -> Options -> Expert Advisors i dodajte URL: ", gServerUrl);
      }
      else
      {
         Print(">>> [MT5 WebRequest POST Error] Kod greške: ", err, " na URL: ", url);
      }
      return false;
   }
   
   if(res >= 200 && res <= 204)
   {
      responseOut = CharArrayToString(resultData, 0, WHOLE_ARRAY, CP_UTF8);
      return true;
   }
   Print(">>> [Server HTTP Response POST] Status kod: ", res, " za URL: ", url);
   if(res == 404)
   {
      Print(">>> [PAŽNJA 404] URL servera ne postoji ili nije aktivan. Proverite URL u InpServerUrl i 'Tools -> Options -> Expert Advisors'!");
   }
   return false;
}

//+------------------------------------------------------------------+
//| Slanje statusa terminala nazad ka Web App-u (Heartbeat)          |
//+------------------------------------------------------------------+
void SendHeartbeat()
{
   int totalPositions = PositionsTotal();
   int aiPositions = 0;
   for(int i = 0; i < totalPositions; i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket > 0 && PositionGetInteger(POSITION_MAGIC) == InpMagicNumber)
      {
         aiPositions++;
      }
   }
   
   string payload = StringFormat(
      "{\\"accountNumber\\":\\"%d\\",\\"broker\\":\\"%s\\",\\"balance\\":%.2f,\\"equity\\":%.2f,\\"margin\\":%.2f,\\"freeMargin\\":%.2f,\\"openPositionsCount\\":%d}",
      (int)AccountInfoInteger(ACCOUNT_LOGIN),
      AccountInfoString(ACCOUNT_COMPANY),
      AccountInfoDouble(ACCOUNT_BALANCE),
      AccountInfoDouble(ACCOUNT_EQUITY),
      AccountInfoDouble(ACCOUNT_MARGIN),
      AccountInfoDouble(ACCOUNT_MARGIN_FREE),
      aiPositions
   );
   
   string postUrl = gServerUrl + "/api/mt5/heartbeat";
   string resp;
   bool ok = HttpPost(postUrl, payload, resp);
   
   // Ako POST nije uspeo (npr. firewall restrikcija), pokreni siguran GET fallback
   if(!ok)
   {
      string getUrl = StringFormat(
         "%s/api/mt5/heartbeat?accountNumber=%d&broker=%s&balance=%.2f&equity=%.2f&margin=%.2f&freeMargin=%.2f&openPositionsCount=%d",
         gServerUrl,
         (int)AccountInfoInteger(ACCOUNT_LOGIN),
         AccountInfoString(ACCOUNT_COMPANY),
         AccountInfoDouble(ACCOUNT_BALANCE),
         AccountInfoDouble(ACCOUNT_EQUITY),
         AccountInfoDouble(ACCOUNT_MARGIN),
         AccountInfoDouble(ACCOUNT_MARGIN_FREE),
         aiPositions
      );
      ok = HttpGet(getUrl, resp);
   }
   
   if(ok)
   {
      static bool sFirstConnected = false;
      if(!sFirstConnected)
      {
         Print(">>> [MT5 Bridge] USPEŠNO POVEZAN SA WEB BOTOM! (Balans: ", DoubleToString(AccountInfoDouble(ACCOUNT_BALANCE), 2), ")");
         sFirstConnected = true;
      }
   }
}

//+------------------------------------------------------------------+
//| Provera i sinhronizacija trejdova sa Web servera                 |
//+------------------------------------------------------------------+
void PollSignalsFromServer()
{
   string url = gServerUrl + "/api/mt5/poll";
   string response;
   
   if(!HttpGet(url, response)) return;
   
   ProcessServerOrders(response);
}

//+------------------------------------------------------------------+
//| Parsiranje i izvršavanje signala                                 |
//+------------------------------------------------------------------+
void ProcessServerOrders(string json)
{
   // 1. Obrada zatvaranja trejdova (Closed trades)
   int closedPos = StringFind(json, "\\"closedTrades\\":");
   if(closedPos >= 0)
   {
      int startArr = StringFind(json, "[", closedPos);
      int endArr   = StringFind(json, "]", startArr);
      if(startArr >= 0 && endArr > startArr)
      {
         string closedSub = StringSubstr(json, startArr + 1, endArr - startArr - 1);
         CloseMarkedPositions(closedSub);
      }
   }

   // 2. Obrada aktivnih trejdova (Active trades)
   int activePos = StringFind(json, "\\"activeTrades\\":");
   if(activePos < 0) return;
   
   int arrayStart = StringFind(json, "[", activePos);
   int arrayEnd   = StringFind(json, "]", arrayStart);
   if(arrayStart < 0 || arrayEnd <= arrayStart) return;
   
   string tradesList = StringSubstr(json, arrayStart + 1, arrayEnd - arrayStart - 1);
   if(StringLen(tradesList) < 5) return;
   
   // Razbijanje po objektima
   int searchPos = 0;
   while(searchPos < StringLen(tradesList))
   {
      int objStart = StringFind(tradesList, "{", searchPos);
      if(objStart < 0) break;
      int objEnd = StringFind(tradesList, "}", objStart);
      if(objEnd < 0) break;
      
      string tradeJson = StringSubstr(tradesList, objStart, objEnd - objStart + 1);
      ExecuteOrSyncTrade(tradeJson);
      
      searchPos = objEnd + 1;
   }
}

//+------------------------------------------------------------------+
//| Izvlačenje string vrednosti iz malog JSON objekta                |
//+------------------------------------------------------------------+
string ExtractJsonString(string json, string key)
{
   string needle = "\\"" + key + "\\":\\"";
   int pos = StringFind(json, needle);
   if(pos < 0) return "";
   pos += StringLen(needle);
   int endPos = StringFind(json, "\\"", pos);
   if(endPos < 0) return "";
   return StringSubstr(json, pos, endPos - pos);
}

//+------------------------------------------------------------------+
//| Izvlačenje numeričke vrednosti iz malog JSON objekta             |
//+------------------------------------------------------------------+
double ExtractJsonDouble(string json, string key)
{
   string needle = "\\"" + key + "\\":";
   int pos = StringFind(json, needle);
   if(pos < 0) return 0.0;
   pos += StringLen(needle);
   
   string numStr = "";
   for(int i = pos; i < StringLen(json); i++)
   {
      ushort ch = StringGetCharacter(json, i);
      if((ch >= '0' && ch <= '9') || ch == '.' || ch == '-')
      {
         numStr += ShortToString(ch);
      }
      else if(StringLen(numStr) > 0)
      {
         break;
      }
   }
   return StringToDouble(numStr);
}

//+------------------------------------------------------------------+
//| Pametno pronalaženje simbola kod brokera (Vantage sufiksi)      |
//+------------------------------------------------------------------+
string ResolveBrokerSymbol(string standardSymbol)
{
   if(SymbolInfoInteger(standardSymbol, SYMBOL_SELECT)) return standardSymbol;
   if(SymbolSelect(standardSymbol, true)) return standardSymbol;
   
   string clean = standardSymbol;
   if(clean == "XAUUSD" || clean == "PAXGUSDT" || clean == "PAXGUSD")
   {
      if(SymbolSelect("XAUUSD", true)) return "XAUUSD";
      if(SymbolSelect("GOLD", true)) return "GOLD";
   }
   if(clean == "GOLD" && SymbolSelect("XAUUSD", true)) return "XAUUSD";

   if(StringFind(clean, "USDT") >= 0)
   {
      StringReplace(clean, "USDT", "USD");
      if(SymbolSelect(clean, true)) return clean;
   }
   
   string suffixes[] = {"+", ".v", ".a", "m", "_pro", ".raw", ".ecn", ".s", ".c", "-c", "pro"};
   for(int i = 0; i < ArraySize(suffixes); i++)
   {
      string testSym = clean + suffixes[i];
      if(SymbolSelect(testSym, true)) return testSym;
      string testSym2 = standardSymbol + suffixes[i];
      if(SymbolSelect(testSym2, true)) return testSym2;
   }
   
   // Pretraga po svim simbolima brokera ako prefiks/sufiks nije standardan
   int totalSymbols = SymbolsTotal(false);
   for(int s = 0; s < totalSymbols; s++)
   {
      string curSym = SymbolName(s, false);
      if(StringFind(curSym, clean) >= 0 || StringFind(curSym, standardSymbol) >= 0)
      {
         if(SymbolSelect(curSym, true)) return curSym;
      }
   }
   
   return standardSymbol;
}

//+------------------------------------------------------------------+
//| Otvaranje ili Ažuriranje Stop Loss-a postojeće pozicije          |
//+------------------------------------------------------------------+
void ExecuteOrSyncTrade(string tradeJson)
{
   string id        = ExtractJsonString(tradeJson, "id");
   string rawSym    = ExtractJsonString(tradeJson, "mt5Symbol");
   if(rawSym == "") rawSym = ExtractJsonString(tradeJson, "symbol");
   string symbol    = ResolveBrokerSymbol(rawSym);
   string typeStr   = ExtractJsonString(tradeJson, "type");
   
   double entry     = ExtractJsonDouble(tradeJson, "entryPrice");
   double sl        = ExtractJsonDouble(tradeJson, "stopLoss");
   double tp        = ExtractJsonDouble(tradeJson, "takeProfit");
   double lot       = ExtractJsonDouble(tradeJson, "lotSize");
   if(lot <= 0 || !InpAutoLotsFromServer) lot = InpFallbackLot;
   if(lot <= 0) lot = 0.01;
   
   if(id == "" || symbol == "") return;
   
   // Normalizacija simbola u MT5 (provera da li simbol postoji u Market Watch)
   if(!SymbolInfoInteger(symbol, SYMBOL_SELECT))
   {
      if(!SymbolSelect(symbol, true))
      {
         PrintFormat(">>> [MT5 Simbol Upozorenje] Simbol '%s' (ili '%s') nije pronađen u ponudi brokera. Preskačem.", symbol, rawSym);
         return;
      }
   }
   
   // Proveri da li je pozicija već otvorena na MT5
   ulong existingTicket = 0;
   double currentPosSL  = 0;
   double currentPosTP  = 0;
   
   int total = PositionsTotal();
   for(int i = 0; i < total; i++)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket > 0 && PositionGetInteger(POSITION_MAGIC) == InpMagicNumber)
      {
         string comment = PositionGetString(POSITION_COMMENT);
         if(StringFind(comment, id) >= 0)
         {
            existingTicket = ticket;
            currentPosSL   = PositionGetDouble(POSITION_SL);
            currentPosTP   = PositionGetDouble(POSITION_TP);
            break;
         }
      }
   }
   
   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   if(digits <= 0) digits = 2;
   double point = SymbolInfoDouble(symbol, SYMBOL_POINT);
   if(point <= 0.0) point = 0.00001;

   double normSL = NormalizeDouble(sl, digits);
   double normTP = NormalizeDouble(tp, digits);
   double tp1    = ExtractJsonDouble(tradeJson, "tp1Price");
   double tp1Hit = ExtractJsonDouble(tradeJson, "tp1Hit"); // 1 or 0

   // 1. Ako pozicija već postoji: Sinhronizuj Stop Loss (Break-Even / Trailing) i TP1 Delimično zatvaranje
   if(existingTicket > 0)
   {
      double normCurSL = NormalizeDouble(currentPosSL, digits);
      double normCurTP = NormalizeDouble(currentPosTP, digits);
      double currentVolume = PositionGetDouble(POSITION_VOLUME);

      // TP1 Izvršenje (Option B): Ako je TP1 pogođen na serveru ili cena dosegla TP1, zatvori 50% lota
      if(tp1Hit > 0.5 && currentVolume >= 0.02)
      {
         string comment = PositionGetString(POSITION_COMMENT);
         if(StringFind(comment, "_TP1") < 0)
         {
            double closeLot = NormalizeDouble(currentVolume / 2.0, 2);
            double minVol = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
            double stepVol = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
            if(stepVol > 0) closeLot = MathFloor(closeLot / stepVol) * stepVol;
            if(closeLot >= minVol && closeLot < currentVolume)
            {
               if(ExtTrade.PositionClosePartial(existingTicket, closeLot))
               {
                  PrintFormat(">>> [TP1 PARTIAL CLOSE 50%%] Pozicija #%d (%s) zatvoreno %.2f lota na TP1.", existingTicket, symbol, closeLot);
               }
            }
         }
      }
      
      // Proveri da li se SL ili TP promenio
      if(MathAbs(normSL - normCurSL) > 2 * point || (normTP > 0 && MathAbs(normTP - normCurTP) > 2 * point))
      {
         MqlTick lastTick;
         if(SymbolInfoTick(symbol, lastTick) && lastTick.bid > 0 && lastTick.ask > 0)
         {
            long stopsLevel = SymbolInfoInteger(symbol, SYMBOL_TRADE_STOPS_LEVEL);
            long spread = SymbolInfoInteger(symbol, SYMBOL_SPREAD);
            double minDistance = MathMax((double)stopsLevel, (double)spread) * point;
            if(minDistance <= 0.0) minDistance = 20 * point;
            
            long posType = PositionGetInteger(POSITION_TYPE);
            bool isValidStop = false;
            
            double targetSL = normSL;
            double targetTP = normTP;
            
            if(posType == POSITION_TYPE_BUY)
            {
               // Za BUY: SL mora biti bezbedno ispod Bid cene za bar minDistance
               if(targetSL > 0)
               {
                  if(targetSL < (lastTick.bid - minDistance))
                  {
                     isValidStop = true;
                  }
                  else
                  {
                     // Ako je preblizu, ne šalji nevažeći SL da broker ne baci grešku 10016
                     isValidStop = false;
                  }
               }
               // TP mora biti iznad Ask cene
               if(targetTP > 0 && targetTP <= (lastTick.ask + minDistance))
               {
                  targetTP = 0; // Ako je TP preblizu, zadrži postojeći
               }
            }
            else if(posType == POSITION_TYPE_SELL)
            {
               // Za SELL: SL mora biti bezbedno iznad Ask cene za bar minDistance
               if(targetSL > 0)
               {
                  if(targetSL > (lastTick.ask + minDistance))
                  {
                     isValidStop = true;
                  }
                  else
                  {
                     isValidStop = false;
                  }
               }
               // TP mora biti ispod Bid cene
               if(targetTP > 0 && targetTP >= (lastTick.bid - minDistance))
               {
                  targetTP = 0;
               }
            }
            
            if(isValidStop && (MathAbs(targetSL - normCurSL) > 2 * point))
            {
               double sendTP = (targetTP > 0 ? targetTP : normCurTP);
               if(ExtTrade.PositionModify(existingTicket, targetSL, sendTP))
               {
                  PrintFormat(">>> [MT5 Sync Success] Pozicija #%d (%s) SL uspešno ažuriran na: %.4f", existingTicket, symbol, targetSL);
               }
            }
         }
      }
      return;
   }
   
   // 2. Ako pozicija ne postoji: Otvori novi trejd u MT5!
   string orderComment = "AI_" + id;
   
   // Bezbedno proveri lot granice (Zero divide zaštita!)
   double minLot  = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
   double maxLot  = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX);
   double lotStep = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
   
   if(minLot > 0.000001 && lot < minLot) lot = minLot;
   if(maxLot > 0.000001 && lot > maxLot) lot = maxLot;
   
   if(lotStep > 0.000001)
   {
      lot = MathFloor(lot / lotStep) * lotStep;
   }
   if(lot <= 0.000001)
   {
      lot = (minLot > 0.000001 ? minLot : 0.01);
   }
   
   MqlTick tick;
   if(!SymbolInfoTick(symbol, tick) || tick.ask <= 0 || tick.bid <= 0)
   {
      PrintFormat(">>> [MT5 Warning] Nema dostupnih tick cena za %s (Ask: %.4f, Bid: %.4f). Preskačem nalog.", symbol, tick.ask, tick.bid);
      return;
   }
   
   // Izračunaj minimalnu dozvoljenu distancu za Stops Level brokera
   long stopsLevel = SymbolInfoInteger(symbol, SYMBOL_TRADE_STOPS_LEVEL);
   long spread = SymbolInfoInteger(symbol, SYMBOL_SPREAD);
   double minDistance = MathMax((double)stopsLevel, (double)spread) * point;
   if(minDistance <= 0.0) minDistance = 20 * point;
   
   // Spread Filter Check: Zaštita od vanredno velikog spreada
   if(InpEnableSpreadFilter)
   {
      double maxAllowedSpreadPips = InpMaxSpreadForex;
      if(StringFind(symbol, "BTC") >= 0) maxAllowedSpreadPips = InpMaxSpreadCrypto;
      else if(StringFind(symbol, "ETH") >= 0 || StringFind(symbol, "SOL") >= 0) maxAllowedSpreadPips = InpMaxSpreadCrypto;
      else if(StringFind(symbol, "XAU") >= 0 || StringFind(symbol, "GOLD") >= 0) maxAllowedSpreadPips = InpMaxSpreadGold;

      double currentSpreadPoints = (tick.ask - tick.bid) / point;
      if(currentSpreadPoints > (maxAllowedSpreadPips * 10))
      {
         PrintFormat(">>> [SPREAD FILTER] Simbol %s trenutni spread (%.1f pts) prelazi limit (%.1f pts). Preskačem ulaz.", 
            symbol, currentSpreadPoints, maxAllowedSpreadPips * 10);
         return;
      }
   }
   
   if(typeStr == "LONG" || typeStr == "BUY")
   {
      // Zaštita od "invalid stops (10016)": SL mora biti bezbedno ispod Bid cene za bar minDistance
      if(normSL > 0 && normSL >= (tick.bid - minDistance))
      {
         normSL = NormalizeDouble(tick.bid - minDistance - (10 * point), digits);
      }
      // TP mora biti bezbedno iznad Ask cene
      if(normTP > 0 && normTP <= (tick.ask + minDistance))
      {
         normTP = NormalizeDouble(tick.ask + minDistance + (10 * point), digits);
      }
      
      bool success = ExtTrade.Buy(lot, symbol, tick.ask, normSL, normTP, orderComment);
      
      // Fallback: Ako broker odbije direktan SL/TP (ECN / Market Execution ili volatilnost), otvori nalog i odmah dodaj SL/TP
      if(!success)
      {
         uint retCode = ExtTrade.ResultRetcode();
         PrintFormat(">>> [MT5 Buy Retry] Direktan nalog sa SL/TP vratio grešku %d (%s). Pokrećem Market izvršenje...", retCode, ExtTrade.ResultRetcodeDescription());
         
         if(ExtTrade.Buy(lot, symbol, 0, 0, 0, orderComment))
         {
            ulong newTicket = ExtTrade.ResultOrder();
            PrintFormat(">>> [MT5 EXECUTION SUCCESS] Kupljeno %s Lot: %.2f @ %.4f (Ticket: %d)", symbol, lot, ExtTrade.ResultPrice(), newTicket);
            
            // Naknadno postavi Stop Loss i Take Profit
            if(normSL > 0 || normTP > 0)
            {
               Sleep(100);
               MqlTick curTick;
               if(SymbolInfoTick(symbol, curTick))
               {
                  if(normSL >= (curTick.bid - minDistance)) normSL = NormalizeDouble(curTick.bid - minDistance - (10 * point), digits);
                  if(normTP > 0 && normTP <= (curTick.ask + minDistance)) normTP = NormalizeDouble(curTick.ask + minDistance + (10 * point), digits);
               }
               ExtTrade.PositionModify(newTicket, normSL, normTP);
            }
         }
         else
         {
            PrintFormat(">>> [MT5 Buy Failed] Simbol: %s, Greška: %s (Kod: %d)", symbol, ExtTrade.ResultRetcodeDescription(), ExtTrade.ResultRetcode());
         }
      }
      else
      {
         PrintFormat(">>> [MT5 EXECUTION] Kupljeno %s Lot: %.2f @ %.4f (SL: %.4f, TP: %.4f, Ticket: %d)", 
            symbol, lot, ExtTrade.ResultPrice(), normSL, normTP, ExtTrade.ResultOrder());
      }
   }
   else if(typeStr == "SHORT" || typeStr == "SELL")
   {
      // Zaštita od "invalid stops (10016)": SL mora biti bezbedno iznad Ask cene za bar minDistance
      if(normSL > 0 && normSL <= (tick.ask + minDistance))
      {
         normSL = NormalizeDouble(tick.ask + minDistance + (10 * point), digits);
      }
      // TP mora biti bezbedno ispod Bid cene
      if(normTP > 0 && normTP >= (tick.bid - minDistance))
      {
         normTP = NormalizeDouble(tick.bid - minDistance - (10 * point), digits);
      }
      
      bool success = ExtTrade.Sell(lot, symbol, tick.bid, normSL, normTP, orderComment);
      
      // Fallback: Ako broker odbije direktan SL/TP (ECN / Market Execution ili volatilnost), otvori nalog i odmah dodaj SL/TP
      if(!success)
      {
         uint retCode = ExtTrade.ResultRetcode();
         PrintFormat(">>> [MT5 Sell Retry] Direktan nalog sa SL/TP vratio grešku %d (%s). Pokrećem Market izvršenje...", retCode, ExtTrade.ResultRetcodeDescription());
         
         if(ExtTrade.Sell(lot, symbol, 0, 0, 0, orderComment))
         {
            ulong newTicket = ExtTrade.ResultOrder();
            PrintFormat(">>> [MT5 EXECUTION SUCCESS] Prodato %s Lot: %.2f @ %.4f (Ticket: %d)", symbol, lot, ExtTrade.ResultPrice(), newTicket);
            
            // Naknadno postavi Stop Loss i Take Profit
            if(normSL > 0 || normTP > 0)
            {
               Sleep(100);
               MqlTick curTick;
               if(SymbolInfoTick(symbol, curTick))
               {
                  if(normSL <= (curTick.ask + minDistance)) normSL = NormalizeDouble(curTick.ask + minDistance + (10 * point), digits);
                  if(normTP > 0 && normTP >= (curTick.bid - minDistance)) normTP = NormalizeDouble(curTick.bid - minDistance - (10 * point), digits);
               }
               ExtTrade.PositionModify(newTicket, normSL, normTP);
            }
         }
         else
         {
            PrintFormat(">>> [MT5 Sell Failed] Simbol: %s, Greška: %s (Kod: %d)", symbol, ExtTrade.ResultRetcodeDescription(), ExtTrade.ResultRetcode());
         }
      }
      else
      {
         PrintFormat(">>> [MT5 EXECUTION] Prodato %s Lot: %.2f @ %.4f (SL: %.4f, TP: %.4f, Ticket: %d)", 
            symbol, lot, ExtTrade.ResultPrice(), normSL, normTP, ExtTrade.ResultOrder());
      }
   }
}

//+------------------------------------------------------------------+
//| Slanje real-time tick-a ka Node.js botu                           |
//+------------------------------------------------------------------+
void PushTickToServer()
{
   string symbolsToSend[] = {"XAUUSD", "EURUSD", "GBPUSD"};
   string sym = _Symbol;
   
   bool isTracked = false;
   for(int i = 0; i < ArraySize(symbolsToSend); i++)
   {
      if(StringFind(sym, symbolsToSend[i]) >= 0)
      {
         isTracked = true;
         sym = symbolsToSend[i];
         break;
      }
   }
   if(!isTracked) return;

   MqlTick tick;
   if(!SymbolInfoTick(_Symbol, tick)) return;

   string payload = StringFormat("{\\"symbol\\":\\"%s\\",\\"bid\\":%.5f,\\"ask\\":%.5f}", sym, tick.bid, tick.ask);
   string resp;
   HttpPost(gServerUrl + "/api/mt5/tick", payload, resp);
}

//+------------------------------------------------------------------+
//| Slanje 5m, 15m i 1h svećica direktno sa Vantage terminala        |
//+------------------------------------------------------------------+
void PushKlinesToServer()
{
   string basePairs[] = {"XAUUSD", "EURUSD", "GBPUSD"};
   ENUM_TIMEFRAMES timeframes[] = {PERIOD_M5, PERIOD_M15, PERIOD_H1};
   string tfNames[] = {"5m", "15m", "1h"};

   for(int p = 0; p < ArraySize(basePairs); p++)
   {
      string standardPair = basePairs[p];
      string brokerSym = ResolveBrokerSymbol(standardPair);
      
      for(int t = 0; t < ArraySize(timeframes); t++)
      {
         MqlRates rates[];
         ArraySetAsSeries(rates, true);
         int count = CopyRates(brokerSym, timeframes[t], 0, 70, rates);
         if(count <= 0) continue;

         string candlesJson = "[";
         for(int i = count - 1; i >= 0; i--)
         {
            string cStr = StringFormat(
               "{\\"time\\":%I64d,\\"open\\":%.5f,\\"high\\":%.5f,\\"low\\":%.5f,\\"close\\":%.5f,\\"volume\\":%I64d}",
               (long)rates[i].time * 1000,
               rates[i].open,
               rates[i].high,
               rates[i].low,
               rates[i].close,
               rates[i].tick_volume
            );
            candlesJson += cStr;
            if(i > 0) candlesJson += ",";
         }
         candlesJson += "]";

         string payload = StringFormat(
            "{\\"symbol\\":\\"%s\\",\\"timeframe\\":\\"%s\\",\\"klines\\":%s}",
            standardPair,
            tfNames[t],
            candlesJson
         );

         string resp;
         HttpPost(gServerUrl + "/api/mt5/klines", payload, resp);
      }
   }
}

//+------------------------------------------------------------------+
//| Zatvaranje pozicija koje je bot označio kao završene             |
//+------------------------------------------------------------------+
void CloseMarkedPositions(string closedList)
{
   int total = PositionsTotal();
   for(int i = total - 1; i >= 0; i--)
   {
      ulong ticket = PositionGetTicket(i);
      if(ticket > 0 && PositionGetInteger(POSITION_MAGIC) == InpMagicNumber)
      {
         string comment = PositionGetString(POSITION_COMMENT);
         // Proveri da li je ovaj tradeId u listi zatvorenih
         if(StringFind(comment, "AI_") >= 0)
         {
            string tradeId = StringSubstr(comment, 3);
            if(StringFind(closedList, tradeId) >= 0)
            {
               if(ExtTrade.PositionClose(ticket))
               {
                  PrintFormat(">>> [MT5 Auto Close] Pozicija #%d (%s) zatvorena na signal bota.", ticket, PositionGetString(POSITION_SYMBOL));
               }
            }
         }
      }
   }
}
//+------------------------------------------------------------------+
`;
}
