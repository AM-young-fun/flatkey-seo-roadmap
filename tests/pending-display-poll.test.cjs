const assert = require("node:assert/strict"), { test } = require("node:test");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");
const root = path.resolve(__dirname, ".."), resolve = Module._resolveFilename, load = Module._load;
const dashboardFile = path.join(root, "src/components/useDashboard.ts"), trendFile = path.join(root, "src/components/RankingTrend.tsx");
Module._resolveFilename = function (name, parent, ...rest) { return resolve.call(this, name.startsWith("@/") ? path.join(root, "src", name.slice(2)) : name, parent, ...rest); };
for (const extension of [".ts", ".tsx"]) require.extensions[extension] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX },
}).outputText, file);

let harness;
const react = {
  useState(initial) {
    const owner = harness, index = owner.cursor++;
    if (!owner.slots[index]) owner.slots[index] = { value: typeof initial === "function" ? initial() : initial };
    return [owner.slots[index].value, next => { owner.slots[index].value = typeof next === "function" ? next(owner.slots[index].value) : next; }];
  },
  useRef(initial) {
    const owner = harness, index = owner.cursor++;
    if (!owner.slots[index]) owner.slots[index] = { current: initial };
    return owner.slots[index];
  },
  useEffect(effect, dependencies) {
    const owner = harness, index = owner.cursor++, previous = owner.slots[index];
    if (previous && dependencies.every((value, i) => Object.is(value, previous.dependencies[i]))) return;
    owner.effects.push(() => { previous?.cleanup?.(); owner.slots[index] = { dependencies, cleanup: effect() }; });
  },
  useCallback(callback) { return callback; },
  useMemo(callback) { return callback(); },
};
class ReadError extends Error {}
const dashboardStore = { revision: () => 0, peek: () => null, hydrate: async () => null, clear() {}, read: (...args) => harness.read(...args) };
const clientReadCache = { clear() {}, read: (...args) => harness.read(...args) };
Module._load = function (name, parent, ...rest) {
  if ([dashboardFile, trendFile].includes(parent?.filename)) {
    if (name === "react") return react;
    if (name === "@/lib/dashboard-client") return { dashboardStore, DashboardReadError: ReadError };
    if (name === "@/lib/client-read-cache") return { clientReadCache, ClientReadError: ReadError };
    if (name === "@/lib/dashboard-session") return { dashboardSession: { load: async () => null, save: async () => {} } };
    if (name === "./ReportLoading") return { ReportLoading() { return null; } };
  }
  return load.call(this, name, parent, ...rest);
};
const { useDashboard } = require(dashboardFile);
const { RankingTrend } = require(trendFile);
Module._load = load;

const settle = () => new Promise(resolve => setImmediate(resolve));
function clock() {
  let now = 0, nextId = 1;
  const tasks = new Map();
  return {
    tasks,
    set(callback, delay) { const id = nextId++; tasks.set(id, { callback, at: now + delay }); return id; },
    clear(id) { tasks.delete(id); },
    async advance(duration) {
      const end = now + duration;
      for (let count = 0; ; count++) {
        assert.ok(count < 100, "retry timers must not multiply without bound");
        const due = [...tasks].filter(([, task]) => task.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
        if (!due) break;
        now = due[1].at; tasks.delete(due[0]); due[1].callback(); await settle();
      }
      now = end;
    },
  };
}
function mount(kind, read) {
  const owner = { slots: [], effects: [], cursor: 0, calls: [], timers: clock(), read(...args) { owner.calls.push(args); return read(...args); } };
  const listeners = new Map();
  const add = (type, callback) => { if (!listeners.has(type)) listeners.set(type, new Set()); listeners.get(type).add(callback); };
  const remove = (type, callback) => listeners.get(type)?.delete(callback);
  const previous = { document: global.document, window: global.window, setTimeout: global.setTimeout, clearTimeout: global.clearTimeout, setInterval: global.setInterval, clearInterval: global.clearInterval };
  global.document = { hidden: false, addEventListener: add, removeEventListener: remove };
  global.window = { addEventListener: add, removeEventListener: remove, setInterval: () => 1, clearInterval() {}, location: { assign() {} } };
  global.setTimeout = owner.timers.set; global.clearTimeout = owner.timers.clear;
  global.setInterval = () => 1; global.clearInterval = () => {};
  const cleanup = () => owner.slots.forEach(slot => slot?.cleanup?.());
  owner.fire = type => listeners.get(type)?.forEach(callback => callback());
  owner.unmount = cleanup;
  owner.restore = () => { cleanup(); for (const [key, value] of Object.entries(previous)) { if (value === undefined) delete global[key]; else global[key] = value; } };
  harness = owner;
  if (kind === "dashboard") useDashboard(); else RankingTrend({});
  owner.effects.splice(0).forEach(effect => effect());
  return owner;
}
function payload(pending) {
  return { schemaVersion: 5, mode: "serp-markets", points: [], keywords: [], topics: [], moduleScope: { module: "all" },
    markets: ["US", "JP", "ES", "BR"].map(region => ({ region, status: "READY", points: [] })), displaySnapshot: { pending } };
}

for (const kind of ["dashboard", "trend"]) {
  test(`${kind}: focus and visibility share one pending retry; fresh data clears it`, async t => {
    let pending = true;
    const ui = mount(kind, async () => payload(pending)); t.after(ui.restore);
    await settle();
    for (let i = 0; i < 4; i++) { ui.fire("focus"); ui.fire("visibilitychange"); await settle(); }
    assert.equal(ui.timers.tasks.size, 1);
    await ui.timers.advance(5000);
    assert.equal(ui.timers.tasks.size, 1, "a retry schedules exactly one successor");
    pending = false;
    ui.fire("focus"); await settle();
    assert.equal(ui.timers.tasks.size, 0);
    const calls = ui.calls.length;
    await ui.timers.advance(20000);
    assert.equal(ui.calls.length, calls, "fresh data cannot leave a forced retry behind");
  });

  test(`${kind}: a late pending response after unmount cannot schedule or send another read`, async t => {
    let release;
    const ui = mount(kind, () => new Promise(resolve => { release = resolve; })); t.after(ui.restore);
    assert.equal(ui.calls.length, 1);
    ui.unmount();
    release(payload(true)); await settle();
    assert.equal(ui.timers.tasks.size, 0);
    await ui.timers.advance(15000);
    assert.equal(ui.calls.length, 1);
  });

  test(`${kind}: hidden tabs do not poll or read on focus; a visible tab resumes`, async t => {
    const ui = mount(kind, async () => payload(true)); t.after(ui.restore);
    await settle();
    global.document.hidden = true;
    ui.fire("visibilitychange"); ui.fire("focus"); ui.fire("seo-rankings-updated");
    await ui.timers.advance(10000);
    assert.equal(ui.calls.length, 1);
    assert.equal(ui.timers.tasks.size, 0);
    global.document.hidden = false;
    ui.fire("visibilitychange"); await settle();
    assert.equal(ui.calls.length, 2);
    assert.equal(ui.timers.tasks.size, 1);
  });

  test(`${kind}: failed reads clear an existing pending retry`, async t => {
    let failure = false;
    const ui = mount(kind, async () => { if (failure) throw Error("unavailable"); return payload(true); }); t.after(ui.restore);
    await settle();
    assert.equal(ui.timers.tasks.size, 1);
    failure = true; ui.fire("focus"); await settle();
    assert.equal(ui.timers.tasks.size, 0);
    const calls = ui.calls.length;
    await ui.timers.advance(15000);
    assert.equal(ui.calls.length, calls);
  });

  test(`${kind}: a response arriving after the tab becomes hidden cannot start a retry chain`, async t => {
    let release;
    const ui = mount(kind, () => new Promise(resolve => { release = resolve; })); t.after(ui.restore);
    global.document.hidden = true;
    release(payload(true)); await settle();
    assert.equal(ui.timers.tasks.size, 0);
    await ui.timers.advance(15000);
    assert.equal(ui.calls.length, 1);
  });
}
