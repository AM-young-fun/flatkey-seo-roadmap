const assert = require("node:assert/strict");
const { test } = require("node:test");
const fs = require("node:fs"), path = require("node:path"), Module = require("node:module"), ts = require("typescript");

require.extensions[".ts"] = (module, file) => module._compile(ts.transpileModule(fs.readFileSync(file, "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
}).outputText, file);
const { createClientReadCache } = require("../src/lib/client-read-cache.ts");
const hookPath = path.resolve(__dirname, "../src/components/useSeoAnalytics.ts");
let harness, cache;
const react = {
  useState(initial) {
    const owner = harness, index = owner.cursor++;
    if (!owner.slots[index]) owner.slots[index] = { value: typeof initial === "function" ? initial() : initial };
    return [owner.slots[index].value, next => {
      const previous = owner.slots[index].value;
      owner.slots[index].value = typeof next === "function" ? next(previous) : next;
    }];
  },
  useRef(initial) {
    const owner = harness, index = owner.cursor++;
    if (!owner.slots[index]) owner.slots[index] = { current: initial };
    return owner.slots[index];
  },
  useEffect(effect, dependencies) {
    const owner = harness, index = owner.cursor++, previous = owner.slots[index];
    if (previous && dependencies.every((value, i) => Object.is(value, previous.dependencies[i]))) return;
    owner.effects.push(() => {
      previous?.cleanup?.();
      owner.slots[index] = { dependencies, cleanup: effect() };
    });
  },
  useSyncExternalStore(subscribe, getSnapshot) {
    const owner = harness, index = owner.cursor++;
    if (!owner.slots[index]) owner.slots[index] = { cleanup: subscribe(() => { owner.invalidations++; }) };
    return getSnapshot();
  },
};
const load = Module._load;
Module._load = function (name, parent, ...rest) {
  if (parent?.filename === hookPath && name === "react") return react;
  if (parent?.filename === hookPath && name === "@/lib/client-read-cache") return { get clientReadCache() { return cache; } };
  return load.call(this, name, parent, ...rest);
};
const { useSeoRead } = require(hookPath);
Module._load = load;

function mount(store) {
  cache = store;
  const listeners = new Set();
  global.document = { hidden: false,
    addEventListener(type, callback) { if (type === "visibilitychange") listeners.add(callback); },
    removeEventListener(type, callback) { if (type === "visibilitychange") listeners.delete(callback); },
  };
  const owner = { slots: [], effects: [], cursor: 0, invalidations: 0,
    render(url) {
      harness = owner; owner.cursor = 0;
      const result = useSeoRead(url);
      owner.effects.splice(0).forEach(effect => effect());
      return result;
    },
    visible() { listeners.forEach(listener => listener()); },
    unmount() { owner.slots.forEach(slot => slot?.cleanup?.()); delete global.document; },
  };
  return owner;
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test("fresh snapshots render synchronously on mount and URL changes without mixing ranges", async () => {
  let calls = 0;
  const store = createClientReadCache(async url => Response.json({ url, version: ++calls }));
  await store.read("/api/seo/analytics?country=US");
  await store.read("/api/seo/analytics?country=JP");
  const ui = mount(store);
  assert.equal(ui.render("/api/seo/analytics?country=US").data.url, "/api/seo/analytics?country=US");
  await settle();
  assert.equal(ui.render("/api/seo/analytics?country=JP").data.url, "/api/seo/analytics?country=JP");
  await settle();
  assert.equal(calls, 2);
  assert.equal(ui.render(null).data, null);
  ui.unmount();
});

test("manual refresh is consumed once; visibility and a different URL still reuse fresh data", async () => {
  let calls = 0;
  const store = createClientReadCache(async url => Response.json({ url, version: ++calls }));
  await store.read("/a"); await store.read("/b");
  const ui = mount(store);
  ui.render("/a"); await settle();
  ui.render("/a").retry();
  ui.render("/a"); await settle();
  assert.equal(ui.render("/a").data.version, 3);
  ui.visible(); await settle();
  assert.equal(calls, 3);
  assert.equal(ui.render("/b").data.version, 2); await settle();
  assert.equal(calls, 3);
  ui.unmount();
});

test("invalidating a session immediately hides old state and discards its late response", async () => {
  const releases = [];
  const store = createClientReadCache(() => new Promise(resolve => releases.push(resolve)));
  const ui = mount(store);
  assert.equal(ui.render("/private").data, null);
  store.clear(); assert.equal(ui.invalidations, 1);
  releases[0](Response.json({ session: "old" })); await settle();
  assert.equal(ui.render("/private").data, null);
  releases[1](Response.json({ session: "current" })); await settle();
  assert.equal(ui.render("/private").data.session, "current");
  store.clear();
  assert.equal(ui.render("/private").data, null);
  ui.unmount();
});

test("a failed refresh displays an error and removes the previous success from cache", async () => {
  let failed = false;
  const store = createClientReadCache(async () => failed
    ? Response.json({ message: "temporarily unavailable" }, { status: 503 }) : Response.json({ total: 17 }));
  await store.read("/report");
  const ui = mount(store);
  assert.equal(ui.render("/report").data.total, 17); await settle();
  failed = true;
  ui.render("/report").retry(); ui.render("/report"); await settle();
  const result = ui.render("/report");
  assert.equal(result.data, null);
  assert.equal(result.error, "temporarily unavailable");
  assert.equal(store.peek("/report"), null);
  ui.unmount();
});

test("pending display snapshots expire at four seconds and invalidation subscriptions can be removed", async () => {
  let now = 0, calls = 0, invalidations = 0;
  const store = createClientReadCache(async () => Response.json({ version: ++calls, displaySnapshot: { pending: true } }), () => now);
  const unsubscribe = store.subscribe(() => invalidations++);
  await store.read("/pending");
  now = 3999; assert.equal(store.peekFresh("/pending").version, 1);
  now = 4000; assert.equal(store.peekFresh("/pending"), null);
  await store.read("/pending"); assert.equal(calls, 2);
  store.clear(); assert.equal(store.revision(), 1); assert.equal(invalidations, 1);
  unsubscribe(); store.clear(); assert.equal(invalidations, 1);
});
