// Vitest setup — provide a minimal in-memory localStorage so importing modules
// that transitively construct the zustand `persist` auth store does not fail
// under the Node test environment. The RBAC unit tests never assert on storage;
// this only keeps the import graph safe.
if (typeof (globalThis as { localStorage?: unknown }).localStorage === 'undefined') {
  const store = new Map<string, string>()
  ;(globalThis as { localStorage?: unknown }).localStorage = {
    getItem: (k: string) => { const v = store.get(k); return v === undefined ? null : v },
    setItem: (k: string, v: string) => void store.set(k, String(v)),
    removeItem: (k: string) => void store.delete(k),
    clear: () => store.clear(),
    key: (i: number) => Array.from(store.keys())[i] ?? null,
    get length() { return store.size },
  }
}
