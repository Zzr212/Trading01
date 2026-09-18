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
    "SOLUSD": 0.20,
    "BNBUSD": 0.10,
    "XRPUSD": 10.0,
    "DOGEUSD": 100.0
  },
  symbolMappings: {
    "BTCUSD": "BTCUSD",
    "ETHUSD": "ETHUSD",
    "SOLUSD": "SOLUSD",
    "BNBUSD": "BNBUSD",
    "XRPUSD": "XRPUSD",
    "DOGEUSD": "DOGEUSD"
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
#property version   "2.10"
#property strict

#include <Trade\\Trade.mqh>

//--- Input Parameters
input group "=== Server Bridge Connection ==="
input string InpServerUrl       = "${cleanUrl}"; // Server Web API URL (Standardni Port 80, Bez kose crte na kraju)
input int    InpTimerSeconds    = 1;                     // Polling Interval (sekunde)
input ulong  InpMagicNumber     = 889900;                // Magic Number za pozicije
input ulong  InpDeviation       = 50;                    // Maksimalno odstupanje / Slippage (poena)

input group "=== Risk & Execution Controls ==="
input bool   InpAutoLotsFromServer = true;               // Koristi veličinu lota definisanu u Web App
input double InpFallbackLot        = 0.01;               // Podrazumevani Lot ako nije podešen u App

//--- Global Variables
CTrade         ExtTrade;
datetime       ExtLastHeartbeat = 0;
string         ExtActiveTradeIds[];
string         gServerUrl = "";

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
   Print(">>> [AI Trader MT5 Bridge v2.1] Pokrenut. Server URL: ", gServerUrl);
   Print(">>> Proverite da li je u MT5: Tools -> Options -> Expert Advisors -> 'Allow WebRequest' dodat tačan URL: ", gServerUrl);
   
   EventSetTimer(InpTimerSeconds);
   SendHeartbeat();
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
}

//+------------------------------------------------------------------+
//| HTTP GET helper funkcija                                         |
//+------------------------------------------------------------------+
bool HttpGet(string url, string &responseOut)
{
   char postData[];
   char resultData[];
   string resultHeaders;
   string headers = "Accept: application/json\\r\\nUser-Agent: MT5-AITrader/2.1\\r\\n";
   
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
   string headers = "Content-Type: application/json\\r\\nAccept: application/json\\r\\nUser-Agent: MT5-AITrader/2.1\\r\\n";
   
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
   if(StringFind(clean, "USDT") >= 0)
   {
      StringReplace(clean, "USDT", "USD");
      if(SymbolSelect(clean, true)) return clean;
   }
   
   string suffixes[] = {"+", ".v", ".a", "m", "_pro", ".raw", ".ecn"};
   for(int i = 0; i < ArraySize(suffixes); i++)
   {
      string testSym = clean + suffixes[i];
      if(SymbolSelect(testSym, true)) return testSym;
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
   
   if(id == "" || symbol == "") return;
   
   // Normalizacija simbola u MT5 (provera da li simbol postoji u Market Watch)
   if(!SymbolInfoInteger(symbol, SYMBOL_SELECT))
   {
      SymbolSelect(symbol, true);
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
   
   // 1. Ako pozicija već postoji: Sinhronizuj Stop Loss (Break-Even / Trailing)
   if(existingTicket > 0)
   {
      int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
      double normSL = NormalizeDouble(sl, digits);
      double normTP = NormalizeDouble(tp, digits);
      double normCurSL = NormalizeDouble(currentPosSL, digits);
      
      // Proveri da li se SL promenio za bar 2 poena
      double point = SymbolInfoDouble(symbol, SYMBOL_POINT);
      if(MathAbs(normSL - normCurSL) > 2 * point)
      {
         // MT5 Broker Stops Validation: Provera trenutne cene
         MqlTick lastTick;
         if(SymbolInfoTick(symbol, lastTick))
         {
            long posType = PositionGetInteger(POSITION_TYPE);
            bool isValidStop = false;
            
            if(posType == POSITION_TYPE_BUY)
            {
               // SL za BUY mora biti ispod trenutne Bid cene
               if(normSL < lastTick.bid && (normTP == 0 || normSL < normTP))
               {
                  isValidStop = true;
               }
            }
            else if(posType == POSITION_TYPE_SELL)
            {
               // SL za SELL mora biti iznad trenutne Ask cene
               if(normSL > lastTick.ask && (normTP == 0 || normSL > normTP))
               {
                  isValidStop = true;
               }
            }
            
            if(isValidStop)
            {
               if(ExtTrade.PositionModify(existingTicket, normSL, normTP))
               {
                  PrintFormat(">>> [MT5 Sync Success] Pozicija #%d (%s) SL uspešno ažuriran na: %.4f", existingTicket, symbol, normSL);
               }
               else
               {
                  PrintFormat(">>> [MT5 Sync Error] Greška pri promeni SL za #%d: %s (Error code: %d)", existingTicket, ExtTrade.ResultRetcodeDescription(), ExtTrade.ResultRetcode());
               }
            }
         }
      }
      return;
   }
   
   // 2. Ako pozicija ne postoji: Otvori novi trejd u MT5!
   int digits = (int)SymbolInfoInteger(symbol, SYMBOL_DIGITS);
   double normSL = NormalizeDouble(sl, digits);
   double normTP = NormalizeDouble(tp, digits);
   string orderComment = "AI_" + id;
   
   // Proveri lot granice
   double minLot = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MIN);
   double maxLot = SymbolInfoDouble(symbol, SYMBOL_VOLUME_MAX);
   double lotStep = SymbolInfoDouble(symbol, SYMBOL_VOLUME_STEP);
   if(lot < minLot) lot = minLot;
   if(lot > maxLot) lot = maxLot;
   lot = MathFloor(lot / lotStep) * lotStep;
   
   if(typeStr == "LONG" || typeStr == "BUY")
   {
      MqlTick tick;
      if(SymbolInfoTick(symbol, tick))
      {
         // Osiguraj da SL nije iznad trenutne cene
         if(normSL >= tick.ask) normSL = NormalizeDouble(tick.ask * 0.995, digits);
         
         if(ExtTrade.Buy(lot, symbol, tick.ask, normSL, normTP, orderComment))
         {
            PrintFormat(">>> [MT5 EXECUTION] Kupljeno %s Lot: %.2f @ %.4f (SL: %.4f, TP: %.4f, Ticket: %d)", 
               symbol, lot, ExtTrade.ResultPrice(), normSL, normTP, ExtTrade.ResultOrder());
         }
         else
         {
            PrintFormat(">>> [MT5 Buy Failed] Simbol: %s, Greška: %s (Kod: %d)", symbol, ExtTrade.ResultRetcodeDescription(), ExtTrade.ResultRetcode());
         }
      }
   }
   else if(typeStr == "SHORT" || typeStr == "SELL")
   {
      MqlTick tick;
      if(SymbolInfoTick(symbol, tick))
      {
         // Osiguraj da SL nije ispod trenutne cene
         if(normSL <= tick.bid) normSL = NormalizeDouble(tick.bid * 1.005, digits);
         
         if(ExtTrade.Sell(lot, symbol, tick.bid, normSL, normTP, orderComment))
         {
            PrintFormat(">>> [MT5 EXECUTION] Prodato %s Lot: %.2f @ %.4f (SL: %.4f, TP: %.4f, Ticket: %d)", 
               symbol, lot, ExtTrade.ResultPrice(), normSL, normTP, ExtTrade.ResultOrder());
         }
         else
         {
            PrintFormat(">>> [MT5 Sell Failed] Simbol: %s, Greška: %s (Kod: %d)", symbol, ExtTrade.ResultRetcodeDescription(), ExtTrade.ResultRetcode());
         }
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
