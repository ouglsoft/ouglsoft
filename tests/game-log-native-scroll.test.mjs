const LOG_VIEW_PATH = "dhamet/site/js/ui/game-log-view.js";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

const source = fs.readFileSync(LOG_VIEW_PATH, "utf8");

class FakeNode {
  constructor(label = "") {
    this.label = label;
    this.dataset = {};
    this.parentNode = null;
  }
  get nextSibling() {
    if (!this.parentNode) return null;
    const rows = this.parentNode.children;
    const index = rows.indexOf(this);
    return index >= 0 ? rows[index + 1] || null : null;
  }
  remove() {
    if (!this.parentNode) return;
    const rows = this.parentNode.children;
    const index = rows.indexOf(this);
    if (index >= 0) rows.splice(index, 1);
    this.parentNode = null;
  }
}

class FakeLog {
  constructor() {
    this.children = [];
    this.clientHeight = 40;
    this._scrollTop = 0;
    this.scrollWrites = 0;
    this.insertions = 0;
    this.listeners = new Map();
  }
  get firstChild() { return this.children[0] || null; }
  get scrollHeight() { return this.children.length * 20; }
  get scrollTop() { return this._scrollTop; }
  set scrollTop(value) {
    this.scrollWrites += 1;
    const max = Math.max(0, this.scrollHeight - this.clientHeight);
    this._scrollTop = Math.max(0, Math.min(max, Number(value) || 0));
  }
  addEventListener(type, fn) {
    if (!this.listeners.has(type)) this.listeners.set(type, []);
    this.listeners.get(type).push(fn);
  }
  dispatch(type) {
    for (const fn of this.listeners.get(type) || []) fn({ type, target: this });
  }
  insertBefore(row, cursor) {
    this.insertions += 1;
    if (row.parentNode) row.remove();
    const index = cursor ? this.children.indexOf(cursor) : -1;
    if (index >= 0) this.children.splice(index, 0, row);
    else this.children.push(row);
    row.parentNode = this;
    return row;
  }
}

const context = { console, document: {}, setTimeout, clearTimeout };
context.globalThis = context;
vm.createContext(context);
vm.runInContext(source, context, { filename: LOG_VIEW_PATH });
const view = context.DhametGameLogView;
assert.ok(view && typeof view.syncElement === "function");

const log = new FakeLog();
const createRow = (item) => new FakeNode(String(item.id));
const keyFor = (item) => String(item.id);
let rows = [1,2,3,4,5].map((id) => ({ id }));
view.syncElement(log, rows, createRow, keyFor, { bottomThreshold: 5 });
assert.equal(log.scrollTop, 60, "first render follows the newest row");

const writesAfterFirstRender = log.scrollWrites;
for (let i = 0; i < 8; i += 1) view.syncElement(log, rows, createRow, keyFor, { bottomThreshold: 5 });
assert.equal(log.scrollWrites, writesAfterFirstRender, "unchanged live snapshots never rewrite scrollTop");

log.dispatch("pointerdown");
log.scrollTop = 10;
log.dispatch("scroll");
const insertedBefore = log.insertions;
rows = [1,2,3,4,5,6].map((id) => ({ id }));
view.syncElement(log, rows, createRow, keyFor, { bottomThreshold: 5 });
assert.equal(log.scrollTop, 10, "a new row cannot pull the log down during a manual gesture");
assert.equal(log.insertions - insertedBefore, 1, "unchanged rows are not detached and rebuilt");
log.dispatch("pointerup");

rows = [1,2,3,4,5,6,7].map((id) => ({ id }));
view.syncElement(log, rows, createRow, keyFor, { bottomThreshold: 5 });
assert.equal(log.scrollTop, 10, "manual position remains after the gesture ends while away from the bottom");

log.scrollTop = log.scrollHeight - log.clientHeight;
log.dispatch("scroll");
rows = [1,2,3,4,5,6,7,8].map((id) => ({ id }));
view.syncElement(log, rows, createRow, keyFor, { bottomThreshold: 5 });
assert.equal(log.scrollTop, 120, "a user already at the bottom follows the new row");
