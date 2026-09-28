// IndexedDB の薄いラッパー。端末内のデータが「正」で、保存した記録は通信断でも消えない。

export type StoreName = 'categories' | 'payment_methods' | 'transactions' | 'settings' | 'outbox' | 'meta';

const DB_NAME = 'cashflow';
const DB_VERSION = 1;

export class Db {
  private dbp: Promise<IDBDatabase> | null = null;

  constructor(private readonly factory: IDBFactory = indexedDB, private readonly name = DB_NAME) {}

  open(): Promise<IDBDatabase> {
    if (this.dbp) return this.dbp;
    this.dbp = new Promise((resolve, reject) => {
      const req = this.factory.open(this.name, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('categories')) db.createObjectStore('categories', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('payment_methods')) db.createObjectStore('payment_methods', { keyPath: 'id' });
        if (!db.objectStoreNames.contains('transactions')) {
          const s = db.createObjectStore('transactions', { keyPath: 'id' });
          s.createIndex('date', 'date');
        }
        if (!db.objectStoreNames.contains('settings')) db.createObjectStore('settings');
        if (!db.objectStoreNames.contains('outbox')) db.createObjectStore('outbox', { keyPath: 'key' });
        if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
      req.onblocked = () => reject(new Error('IndexedDB blocked'));
    });
    return this.dbp;
  }

  private async tx(store: StoreName, mode: IDBTransactionMode): Promise<IDBObjectStore> {
    const db = await this.open();
    return db.transaction(store, mode).objectStore(store);
  }

  private req<T>(r: IDBRequest<T>): Promise<T> {
    return new Promise((resolve, reject) => {
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }

  async getAll<T>(store: StoreName): Promise<T[]> {
    return this.req((await this.tx(store, 'readonly')).getAll() as IDBRequest<T[]>);
  }

  async get<T>(store: StoreName, key: IDBValidKey): Promise<T | undefined> {
    return this.req((await this.tx(store, 'readonly')).get(key) as IDBRequest<T | undefined>);
  }

  async put<T>(store: StoreName, value: T, key?: IDBValidKey): Promise<void> {
    await this.req((await this.tx(store, 'readwrite')).put(value, key));
  }

  async putMany<T>(store: StoreName, values: T[]): Promise<void> {
    if (values.length === 0) return;
    const db = await this.open();
    await new Promise<void>((resolve, reject) => {
      const t = db.transaction(store, 'readwrite');
      const s = t.objectStore(store);
      for (const v of values) s.put(v);
      t.oncomplete = () => resolve();
      t.onerror = () => reject(t.error);
      t.onabort = () => reject(t.error);
    });
  }

  async delete(store: StoreName, key: IDBValidKey): Promise<void> {
    await this.req((await this.tx(store, 'readwrite')).delete(key));
  }

  async clear(store: StoreName): Promise<void> {
    await this.req((await this.tx(store, 'readwrite')).clear());
  }

  async count(store: StoreName): Promise<number> {
    return this.req((await this.tx(store, 'readonly')).count());
  }
}
