import { DatabaseSync } from 'node:sqlite';
import { readFileSync } from 'node:fs';
export function createTestD1() {
  const db = new DatabaseSync(':memory:');
  db.exec(readFileSync(new URL('../../worker/schema.sql', import.meta.url), 'utf8'));
  return {
    get _tables() {
      const tables = new Map();
      for (const { name } of db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all()) {
        const rows = db.prepare(`SELECT * FROM ${name}`).all();
        const pk = db.prepare(`PRAGMA table_info(${name})`).all().find(c => c.pk)?.name;
        tables.set(name, new Map(rows.map(row => [String(row[pk]), row])));
      }
      return tables;
    },
    tableNames() { return db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all().map(r => r.name); },
    prepare(sql) {
      let values = [];
      const statement = {
        bind(...args) { values = args; return statement; },
        async first() { return db.prepare(sql).get(...values) || null; },
        async all() { return { results: db.prepare(sql).all(...values) }; },
        async run() { const r = db.prepare(sql).run(...values); return { meta: { changes: Number(r.changes) } }; },
      };
      return statement;
    },
  };
}
