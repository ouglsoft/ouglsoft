// In-memory stand-in for a Durable Object's storage (the parts the object uses), with the
// limits that matter: at most 128 keys per put or delete, and an optional failure on a key.
import assert from 'node:assert/strict';

export class FakeStorage {
  constructor() { this.map = new Map(); this.log = []; this.failOn = null; }
  async get(keys) {
    if (Array.isArray(keys)) { const out = new Map(); for (const k of keys) if (this.map.has(k)) out.set(k, structuredClone(this.map.get(k))); return out; }
    return structuredClone(this.map.get(keys));
  }
  async put(a, b) {
    const entries = typeof a === 'string' ? { [a]: b } : a;
    const keys = Object.keys(entries);
    assert.ok(keys.length <= 128, 'a put carries at most 128 keys');
    if (this.failOn && keys.includes(this.failOn)) throw new Error('storage failed on ' + this.failOn);
    for (const k of keys) this.map.set(k, structuredClone(entries[k]));
    this.log.push({ op: 'put', keys });
  }
  async delete(keys) {
    const list = Array.isArray(keys) ? keys : [keys];
    assert.ok(list.length <= 128, 'a delete carries at most 128 keys');
    for (const k of list) this.map.delete(k);
    this.log.push({ op: 'delete', keys: list });
    return list.length;
  }
  async list({ prefix = '' } = {}) {
    const out = new Map();
    for (const k of [...this.map.keys()].sort()) if (k.startsWith(prefix)) out.set(k, structuredClone(this.map.get(k)));
    return out;
  }
  async setAlarm() {}
  async getAlarm() { return null; }
  async deleteAlarm() {}
}
