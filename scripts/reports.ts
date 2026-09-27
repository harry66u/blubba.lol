/**
 * Prints the latest player reports from the database (for moderators).
 * Usage: BUBBA_DB=data/bubba.db npx tsx scripts/reports.ts [limit]
 */
import { Store } from '../src/server/store';

const store = new Store(process.env.BUBBA_DB ?? 'data/bubba.db');
const limit = Number(process.argv[2] ?? 50);
const rows = store.reports(limit);
if (!rows.length) console.log('No reports.');
for (const r of rows) {
  console.log(`${new Date(r.at).toISOString()}  ${r.reason.padEnd(8)}  "${r.target_name}" (${r.target})  room ${r.room}  reported by ${r.reporter}`);
}
store.close();
