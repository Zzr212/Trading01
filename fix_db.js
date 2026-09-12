const Database = require('better-sqlite3');
const db = new Database('trades.db');
try {
  db.exec("ALTER TABLE trades ADD COLUMN closeTimestamp INTEGER");
} catch(e) {
  console.log(e.message);
}
