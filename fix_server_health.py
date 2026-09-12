with open('server.ts', 'r') as f:
    content = f.read()

health_endpoint = """  // System Diagnostics & Health Check
  app.get("/api/system-health", (req, res) => {
    try {
      const startDb = Date.now();
      const countRow = db.prepare("SELECT COUNT(*) as count FROM trades").get() as any;
      const dbLatencyMs = Date.now() - startDb;
      
      const botDiagnostics = bot.getDiagnostics();
      
      res.json({
        timestamp: Date.now(),
        serverUptime: Math.floor(process.uptime()),
        database: {
          status: 'CONNECTED',
          type: 'SQLite3 (Sync)',
          latencyMs: dbLatencyMs,
          totalTrades: countRow ? countRow.count : 0
        },
        ...botDiagnostics
      });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  // API Routes
  app.get("/api/stats", (req, res) => {"""

content = content.replace("  // API Routes\n  app.get(\"/api/stats\", (req, res) => {", health_endpoint)

with open('server.ts', 'w') as f:
    f.write(content)
print("server.ts updated with /api/system-health")
