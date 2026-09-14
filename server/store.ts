import { DatabaseSync } from "node:sqlite";
import { StoreCore, type DatabaseAdapter } from "./store-core.ts";
export * from "./store-core.ts";
export class Store extends StoreCore {
  constructor(path: string) {
    const db = new DatabaseSync(path);
    db.exec("PRAGMA journal_mode=WAL");
    const adapter: DatabaseAdapter = {
      exec: (sql) => db.exec(sql),
      prepare: (sql) => db.prepare(sql),
      close: () => db.close(),
      transaction: (work) => {
        db.exec("BEGIN IMMEDIATE");
        try {
          const result = work();
          db.exec("COMMIT");
          return result;
        } catch (error) {
          db.exec("ROLLBACK");
          throw error;
        }
      },
    };
    super(adapter);
  }
}
