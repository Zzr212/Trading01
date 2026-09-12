import re

with open('server.ts', 'r') as f:
    content = f.read()

stats_route = """  app.get("/api/stats", (req, res) => {
    try {
      const stmt = db.prepare("SELECT pair, status, COUNT(*) as count FROM trades GROUP BY pair, status");
      const rows = stmt.all() as any[];
      
      const stats: Record<string, { won: number, lost: number, active: number }> = {};
      
      rows.forEach(r => {
        if (!stats[r.pair]) stats[r.pair] = { won: 0, lost: 0, active: 0 };
        if (r.status === 'WON') stats[r.pair].won = r.count;
        if (r.status === 'LOST') stats[r.pair].lost = r.count;
        if (r.status === 'ACTIVE') stats[r.pair].active = r.count;
      });
      
      res.json(stats);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  });

  app.get("/api/trades", (req, res) => {"""

content = content.replace('  app.get("/api/trades", (req, res) => {', stats_route)

with open('server.ts', 'w') as f:
    f.write(content)
