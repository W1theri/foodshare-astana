import { readFile } from 'node:fs/promises';
import { DatabaseSync } from 'node:sqlite';

export async function openCatalogue(filename) {
  const sqlite = new DatabaseSync(filename);
  sqlite.exec('PRAGMA journal_mode = WAL;');
  if (!sqlite.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='app_state'").get()) {
    sqlite.exec('BEGIN');
    try {
      sqlite.exec(await readFile(new URL('../drizzle/0000_shared_catalogue.sql', import.meta.url), 'utf8'));
      sqlite.exec('COMMIT');
    } catch (error) {
      sqlite.exec('ROLLBACK');
      sqlite.close();
      throw error;
    }
  }
  sqlite.exec(await readFile(new URL('../drizzle/0001_practice_workspaces.sql', import.meta.url), 'utf8'));
  return {
    close: () => sqlite.close(),
    prepare(sql) {
      const statement = sqlite.prepare(sql);
      function bind(...values) {
        const run = () => ({ meta: { changes: statement.run(...values).changes } });
        return { bind, first: async () => statement.get(...values), run: async () => run(), runSync: run };
      }
      return bind();
    },
    async batch(statements) {
      sqlite.exec('BEGIN');
      try {
        const results = statements.map(statement => statement.runSync());
        sqlite.exec('COMMIT');
        return results;
      } catch (error) {
        sqlite.exec('ROLLBACK');
        throw error;
      }
    },
  };
}
