import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import test from 'node:test';
import vm from 'node:vm';

const source = await readFile(new URL('../src/client.js', import.meta.url), 'utf8');
function load(react = {}, extra = {}) {
  let registration;
  const required = [];
  const sandbox = {
    window: { __ModuleLoader__: { load(value) { registration = value; } } },
    AbortController, setTimeout, clearTimeout, ...extra,
  };
  vm.runInNewContext(source, sandbox, { filename: 'client.js' });
  const api = registration.factory((name) => {
    required.push(name);
    assert.equal(name, 'react');
    return react;
  });
  return { api, registration, required };
}
const { api } = load();
const tick = () => new Promise(setImmediate);
const response = (body, status = 200) => ({ ok: status >= 200 && status < 300, status, json: async () => body });
const operation = (n = 1) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const csrf = (n = 1) => Number(n).toString(16).padStart(64, '0');
function status(changes = {}) {
  const value = { apiVersion: 2, supported: true, ready: true, busy: false, reason: 'Host copy must not be shown',
    reasonCode: 'READY', sessionId: 'A', csrf: csrf(), resetCount: 2, ...changes };
  if (!Object.hasOwn(changes, 'ready')) value.ready = value.supported && !value.busy;
  if (!Object.hasOwn(changes, 'reasonCode')) {
    value.reasonCode = value.busy ? 'BUSY' : !value.supported ? 'UNSUPPORTED_PROVIDER' : value.ready ? 'READY' : 'LOADING';
  }
  return value;
}
const success = (changes = {}) => response({ apiVersion: 2, sessionId: 'A', operationId: operation(),
  ok: true, changed: true, message: '不应依赖此宿主文案', sessions: ['A'], addedCount: 1, resetCount: 3, ...changes });
function deferred() {
  let resolve, reject;
  const promise = new Promise((a, b) => { resolve = a; reject = b; });
  return { promise, resolve, reject };
}
function makeLocale(initial = 'zh', registerInitial = true) {
  let snapshot = { active: initial, revision: 0 };
  const listeners = new Set(), dictionaries = new Map(), bindings = new Map();
  const publish = () => { snapshot = { ...snapshot, revision: snapshot.revision + 1 }; for (const fn of [...listeners]) fn(); };
  const locale = {
    getSnapshot: () => snapshot,
    subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    register(ns, dicts) {
      assert.ok(dicts.en && dicts.zh);
      assert.equal(dictionaries.has(ns), false, 'register a namespace once');
      dictionaries.set(ns, dicts); publish();
      let live = true;
      return () => { if (!live) return; live = false; dictionaries.delete(ns); publish(); };
    },
    bind(ns) {
      if (!bindings.has(ns)) bindings.set(ns, (key, params) => {
        const dicts = dictionaries.get(ns);
        const template = dicts?.[snapshot.active]?.[key] ?? dicts?.en?.[key] ?? key;
        return params ? template.replace(/\{(\w+)\}/g, (match, name) => name in params ? String(params[name]) : match) : template;
      });
      return bindings.get(ns);
    },
    setLocale(active) { if (snapshot.active === active) return; snapshot = { ...snapshot, active }; publish(); },
    refreshDictionary() { publish(); },
    listeners, dictionaries,
  };
  if (registerInitial) locale.register(api.LOCALE_NS, api.DICTIONARIES);
  return locale;
}
function setup(t, options = {}) {
  let guard = { active: true, busy: false, reasonCode: 'READY' };
  const subscribers = new Set(), calls = [];
  const locale = options.locale ?? makeLocale(options.language);
  const translate = locale.bind(api.LOCALE_NS);
  const sessionId = options.sessionId ?? 'A';
  let nextId = 0;
  const controller = api.createResetController({
    sessionId, locale, t: translate,
    getGuard: options.getGuard ?? (() => guard),
    subscribeGuard: options.subscribeGuard ?? ((fn) => { subscribers.add(fn); return () => subscribers.delete(fn); }),
    fetch(url, init) {
      const call = { url, init }; calls.push(call);
      if (options.fetch) return options.fetch(call, calls.length);
      return Promise.resolve(init.method === 'POST'
        ? success(JSON.parse(init.body)) : response(status({ sessionId })));
    },
    operationId: options.operationId ?? (() => operation(++nextId)),
    locks: options.locks, timeoutMs: options.timeoutMs ?? 1000,
  });
  t.after(() => controller.dispose());
  return { controller, calls, subscribers, locale, translate,
    change(value, notify = true) {
      guard = { ...guard, ...value };
      if (notify) for (const listener of subscribers) listener();
    },
    connect: () => controller.connect(),
  };
}
function sourceOf(initial) {
  let value = initial;
  const listeners = new Set();
  return { getSnapshot: () => value, subscribe(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    set(next, notify = true) { value = next; if (notify) for (const fn of [...listeners]) fn(); }, listeners };
}
function scope() {
  const effects = new Set();
  let alive = true, releases = 0;
  return {
    effect(fn) {
      if (!alive) throw new Error('scope disposed');
      const cleanup = fn(); let live = true;
      const release = () => { if (!live) return; live = false; effects.delete(release); releases++; cleanup?.(); };
      effects.add(release); return release;
    },
    dispose() { if (!alive) return; alive = false; for (const release of [...effects].reverse()) release(); },
    get releases() { return releases; }, effects,
  };
}
function applyHarness({ fetch, language = 'zh' } = {}) {
  const root = scope(), locale = makeLocale(language, false), retention = sourceOf({ referenceCount: 1, retainedBy: { mainView: 1 } });
  const pending = sourceOf(new Map()), calls = [], allBindings = [];
  const createBinding = () => {
    const owner = scope();
    const binding = { ctx: owner, session: sourceOf({ sessionId: 'A', running: false, removed: false }) };
    allBindings.push(binding); return binding;
  };
  let binding = createBinding(), registration, nextId = 0;
  const ctx = { effect: root.effect, locale,
    sessions: { binding: () => binding, retainInfo: () => retention },
    uiSession: { sessionStatus: pending },
    slots: { inject(name, callback) { assert.equal(name, 'conversation.input.right'); return callback(); },
      register(value) { registration = value; return () => {}; } },
  };
  Object.defineProperty(ctx.sessions, 'list', { get() { throw new Error('must use public retention source'); } });
  Object.defineProperty(ctx.uiSession, 'adapter', { get() { throw new Error('must not read renderer internals'); } });
  const { api: localApi } = load({}, { crypto: { randomUUID: () => operation(++nextId) }, fetch: (url, init) => {
    const call = { url, init }; calls.push(call);
    if (fetch) return fetch(call, calls.length);
    return Promise.resolve(init.method === 'POST' ? success(JSON.parse(init.body)) : response(status()));
  } });
  localApi.apply(ctx);
  return { api: localApi, root, locale, retention, pending, calls, ctx, allBindings,
    get registration() { return registration; }, get binding() { return binding; },
    controller: () => registration.inject('A').controller,
    replaceBinding() { binding = createBinding(); return binding; },
    dispose() { root.dispose(); for (const item of allBindings) item.ctx.dispose(); },
  };
}

test('native lazy bundle uses only host React and exposes the Cordis plugin', () => {
  const { registration, required, api } = load();
  assert.equal(registration.id, 'dsh-replay-reset');
  assert.deepEqual(required, ['react']);
  assert.deepEqual(Array.from(api.inject), ['slots', 'sessions', 'uiSession', 'locale']);
  assert.equal(typeof api.apply, 'function');
  assert.doesNotMatch(source, /MutationObserver|querySelector|localStorage|sessionStorage|setInterval|\.submit\(|adapter\.current/);
});

test('registers the native session slot only after declaration and sends nothing during apply', () => {
  let install, options, component;
  const owner = scope(), locale = makeLocale('zh', false);
  const ctx = { effect: owner.effect, locale, slots: {
    inject(name, callback) { assert.equal(name, 'conversation.input.right'); install = callback; },
    register(value, render) { options = value; component = render; return () => {}; },
  } };
  api.apply(ctx);
  assert.equal(options, undefined);
  install();
  assert.equal(options.name, 'conversation.input.right');
  assert.equal(options.id, 'replay-reset');
  assert.equal(options.order, 1000);
  assert.equal(options.locale, api.LOCALE_NS);
  assert.equal(component, api.ResetButton);
  assert.equal(locale.dictionaries.has(api.LOCALE_NS), true);
  owner.dispose();
  assert.equal(locale.dictionaries.has(api.LOCALE_NS), false);
});

test('mount only checks status; button click preflights and sends exactly one same-origin POST', async (t) => {
  const h = setup(t, { fetch: (call, n) => Promise.resolve(call.init.method === 'POST'
    ? success(JSON.parse(call.init.body)) : response(status({ csrf: csrf(n) }))) });
  h.connect(); await tick();
  assert.equal(h.calls.length, 1);
  assert.equal(h.controller.getSnapshot().ready, true);
  assert.equal('csrf' in h.controller.getSnapshot(), false);
  assert.equal(await h.controller.reset(), true);
  assert.deepEqual(h.calls.map((c) => c.init.method), ['GET', 'GET', 'POST']);
  const post = h.calls[2];
  assert.equal(post.url, '/plugins/replay-reset/reset');
  assert.deepEqual(JSON.parse(post.init.body), { sessionId: 'A', operationId: operation() });
  assert.equal(post.init.headers['x-replay-reset-csrf'], csrf(2));
  for (const { init } of h.calls) {
    assert.equal(init.credentials, 'same-origin'); assert.equal(init.mode, 'same-origin');
    assert.equal(init.redirect, 'error'); assert.equal(init.cache, 'no-store'); assert.equal(init.headers.Authorization, undefined);
  }
  assert.equal(h.controller.getSnapshot().resetCount, 3);
  assert.equal(h.controller.getSnapshot().addedCount, 1);
  assert.equal(h.controller.getSnapshot().kind, 'success');
  assert.equal(JSON.stringify(h.controller.getSnapshot()).includes(csrf(2)), false);
});

test('encodes the native session identifier as one query value', async (t) => {
  const id = 'session /?&中';
  const h = setup(t, { sessionId: id, fetch: async () => response(status({ sessionId: id })) });
  h.connect(); await tick();
  assert.equal(h.calls[0].url, `/plugins/replay-reset/status?sessionId=${encodeURIComponent(id)}`);
});

test('rapid clicks are locked before preflight and remain locked during POST', async (t) => {
  const preflight = deferred(), post = deferred();
  const h = setup(t, { fetch: (call, n) => n === 1 ? Promise.resolve(response(status())) : n === 2 ? preflight.promise : post.promise });
  h.connect(); await tick();
  const first = h.controller.reset();
  assert.equal(h.controller.getSnapshot().phase, 'resetting');
  assert.equal(await h.controller.reset(), false); assert.equal(h.calls.length, 2);
  preflight.resolve(response(status())); await tick();
  assert.equal(await h.controller.reset(), false); assert.equal(h.calls.length, 3);
  post.resolve(success()); assert.equal(await first, true);
});

for (const [name, changes] of [
  ['unsupported', { supported: false, ready: false, csrf: undefined }],
  ['not ready', { ready: false }], ['busy', { busy: true }],
]) {
  test(`${name} status prevents reset and allows GET-only status recovery`, async (t) => {
    const h = setup(t, { fetch: async () => response(status(changes)) });
    h.connect(); await tick();
    assert.equal(await h.controller.reset(), false);
    await h.controller.refresh();
    assert.equal(h.calls.length, 2); assert.ok(h.calls.every((call) => call.init.method === 'GET'));
    assert.equal(h.controller.getSnapshot().canCheck, true);
  });
}

test('fresh preflight refusal overrides an earlier ready status with localized reasonCode', async (t) => {
  const h = setup(t, { fetch: async (call, n) => response(status(n === 1 ? {} : { busy: true, reason: 'must ignore host reason' })) });
  h.connect(); await tick();
  assert.equal(await h.controller.reset(), false); assert.equal(h.calls.length, 2);
  assert.equal(h.controller.getSnapshot().message, h.translate('code.BUSY'));
});

for (const [name, value] of [
  ['another session', status({ sessionId: 'B' })], ['missing CSRF', status({ csrf: undefined })],
  ['empty CSRF', status({ csrf: ' ' })], ['CSRF header injection', status({ csrf: 'bad\r\nheader' })],
  ['non-boolean status', status({ ready: 'yes' })], ['null body', null],
  ['missing API version', { ...status(), apiVersion: undefined }], ['old API version', status({ apiVersion: 1 })],
  ['future API version', status({ apiVersion: 3 })], ['string API version', status({ apiVersion: '2' })],
  ['negative cumulative count', status({ resetCount: -1 })], ['fractional cumulative count', status({ resetCount: 1.5 })],
  ['unsafe cumulative count', status({ resetCount: Number.MAX_SAFE_INTEGER + 1 })], ['missing cumulative count', status({ resetCount: undefined })],
  ['string cumulative count', status({ resetCount: '2' })], ['invalid reason code', status({ reasonCode: 'READY\r\nBAD' })],
  ['missing reason code', status({ reasonCode: undefined })], ['ready while busy', status({ ready: true, busy: true })],
  ['ready while unsupported', status({ ready: true, supported: false, reasonCode: 'READY' })],
  ['ready with failure code', status({ reasonCode: 'POLICY_LOAD_FAILED' })],
  ['non-hex CSRF', status({ csrf: 'é'.repeat(64) })], ['uppercase CSRF', status({ csrf: 'A'.repeat(64) })],
]) {
  test(`rejects ${name} without POST`, async (t) => {
    const h = setup(t, { fetch: async () => response(value) });
    h.connect(); await tick();
    assert.equal(h.controller.getSnapshot().phase, 'error');
    assert.equal(await h.controller.reset(), false); assert.equal(h.calls.length, 1);
    assert.ok(h.controller.getSnapshot().message);
  });
}

test('old Host version fails closed and a later explicit GET recovers without POST', async (t) => {
  let version = 1;
  const h = setup(t, { fetch: async () => response(status({ apiVersion: version })) });
  h.connect(); await tick();
  assert.equal(h.controller.getSnapshot().phase, 'error');
  assert.match(h.controller.getSnapshot().reason, /API/);
  assert.equal(await h.controller.reset(), false);
  version = 2; await h.controller.refresh();
  assert.equal(h.controller.getSnapshot().ready, true);
  assert.deepEqual(h.calls.map((call) => call.init.method), ['GET', 'GET']);
});

test('unknown status code is localized with safe code-only detail and remains GET-only', async (t) => {
  const h = setup(t, { language: 'en', fetch: async () => response(status({ ready: false,
    reasonCode: 'NEW_HOST_DIAGNOSTIC', reason: 'secret raw host text' })) });
  h.connect(); await tick();
  assert.match(h.controller.getSnapshot().reason, /NEW_HOST_DIAGNOSTIC/);
  assert.doesNotMatch(h.controller.getSnapshot().reason, /secret raw/);
  assert.equal(await h.controller.reset(), false);
  await h.controller.refresh(); assert.ok(h.calls.every((call) => call.init.method === 'GET'));
});

test('navigation during preflight never posts to either old or new session', async (t) => {
  const pending = deferred();
  const h = setup(t, { fetch: (call, n) => n === 1 ? Promise.resolve(response(status())) : pending.promise });
  h.connect(); await tick();
  const resetting = h.controller.reset(); h.change({ active: false, reasonCode: 'CLIENT_NOT_MAIN' });
  assert.equal(h.calls[1].init.signal.aborted, true);
  pending.resolve(response(status()));
  assert.equal(await resetting, false); assert.equal(h.calls.length, 2); assert.equal(h.controller.getSnapshot().ready, false);
});

test('A to B to A invalidates the original preflight even when the id returns', async (t) => {
  const pending = deferred();
  const h = setup(t, { fetch: (call, n) => n === 2 ? pending.promise : Promise.resolve(response(status())) });
  h.connect(); await tick();
  const resetting = h.controller.reset(); h.change({ active: false }); h.change({ active: true });
  pending.resolve(response(status()));
  assert.equal(await resetting, false); await tick();
  assert.ok(h.calls.every((call) => call.init.method === 'GET')); assert.equal(h.controller.getSnapshot().ready, true);
});

test('native current-session guard is reread even if change notification is delayed', async (t) => {
  const pending = deferred();
  const h = setup(t, { fetch: (call, n) => n === 1 ? Promise.resolve(response(status())) : pending.promise });
  h.connect(); await tick(); const resetting = h.controller.reset();
  h.change({ active: false }, false); pending.resolve(response(status()));
  assert.equal(await resetting, false); assert.ok(h.calls.every((call) => call.init.method === 'GET'));
});

test('running state blocks clicks and only triggers a status read when it becomes idle', async (t) => {
  const h = setup(t); h.connect(); await tick();
  h.change({ busy: true, reasonCode: 'SESSION_BUSY' });
  assert.equal(h.controller.getSnapshot().canCheck, false); assert.equal(await h.controller.reset(), false); assert.equal(h.calls.length, 1);
  h.change({ busy: false, reasonCode: 'READY' }); await tick();
  assert.equal(h.calls.length, 2); assert.equal(h.controller.getSnapshot().ready, true);
});

test('navigation after POST suppresses the old result and never automatically repeats POST', async (t) => {
  const pending = deferred();
  const h = setup(t, { fetch: (call) => call.init.method === 'POST' ? pending.promise : Promise.resolve(response(status())) });
  h.connect(); await tick(); const resetting = h.controller.reset(); await tick();
  h.change({ active: false });
  assert.equal(h.calls.at(-1).init.signal.aborted, false, 'navigation is not a server rollback');
  pending.resolve(success()); assert.equal(await resetting, false); assert.notEqual(h.controller.getSnapshot().kind, 'success');
  h.change({ active: true }); await tick();
  assert.equal(h.calls.filter((call) => call.init.method === 'POST').length, 1);
});

test('shared per-session lock protects a replacement binding until the old POST settles', async (t) => {
  const locks = new Map(), pending = deferred();
  const old = setup(t, { locks, fetch: (call) => call.init.method === 'POST' ? pending.promise : Promise.resolve(response(status())) });
  const disconnect = old.connect(); await tick(); const resetting = old.controller.reset(); await tick(); disconnect();
  const next = setup(t, { locks }); next.connect(); await tick();
  assert.equal(next.calls.length, 0); assert.equal(next.controller.getSnapshot().phase, 'resetting');
  assert.equal(await next.controller.reset(), false);
  pending.resolve(success()); await resetting; await tick();
  assert.equal(next.calls.length, 1); assert.equal(next.calls[0].init.method, 'GET'); assert.equal(next.controller.getSnapshot().ready, true);
});

test('multiple renders share one guard subscription, one locale subscription and one mount-time GET', async (t) => {
  const h = setup(t); const first = h.connect(), second = h.connect(); await tick();
  assert.equal(h.calls.length, 1); assert.equal(h.subscribers.size, 1); assert.equal(h.locale.listeners.size, 1);
  first(); first(); assert.equal(h.subscribers.size, 1); assert.equal(h.locale.listeners.size, 1);
  assert.equal(await h.controller.reset(), true);
  second(); assert.equal(h.subscribers.size, 0); assert.equal(h.locale.listeners.size, 0);
});

test('unmount aborts status, reconnect refreshes, and late completion cannot overwrite it', async (t) => {
  const pending = deferred();
  const h = setup(t, { fetch: (call, n) => n === 1 ? pending.promise : Promise.resolve(response(status())) });
  const disconnect = h.connect(); disconnect(); assert.equal(h.calls[0].init.signal.aborted, true);
  h.connect(); await tick(); pending.resolve(response(status({ supported: false, ready: false }))); await tick();
  assert.equal(h.controller.getSnapshot().ready, true); assert.equal(h.subscribers.size, 1);
});

for (const [name, fetch] of [
  ['401 auth error', async () => response({}, 401)],
  ['403 CSRF error', async () => response({ apiVersion: 2, code: 'CSRF_EXPIRED', error: 'ignored' }, 403)],
  ['non-JSON HTML', async () => ({ ok: true, status: 200, json: async () => { throw Error('HTML'); } })],
  ['network failure', async () => { throw Error('offline'); }],
]) {
  test(`shows ${name} explicitly and retry is GET-only`, async (t) => {
    const h = setup(t, { fetch }); h.connect(); await tick();
    assert.equal(h.controller.getSnapshot().phase, 'error'); assert.equal(h.controller.getSnapshot().kind, 'error');
    assert.ok(h.controller.getSnapshot().message); await h.controller.refresh();
    assert.equal(h.calls.length, 2); assert.ok(h.calls.every((call) => call.init.method === 'GET'));
  });
}

test('HTTP status failures are localized from the Host code, not its text', async (t) => {
  const h = setup(t, { fetch: async () => response({ apiVersion: 2, ok: false, code: 'AUTH_UNAVAILABLE', error: 'untranslated host text' }, 503) });
  h.connect(); await tick();
  assert.equal(h.controller.getSnapshot().message, h.translate('code.AUTH_UNAVAILABLE'));
  assert.equal(h.controller.getSnapshot().phase, 'error'); assert.equal(await h.controller.reset(), false); assert.equal(h.calls.length, 1);
});

test('HTTP reset failures preserve localized code semantics and never auto-retry', async (t) => {
  const h = setup(t, { fetch: async (call) => call.init.method === 'POST'
    ? response({ apiVersion: 2, ok: false, code: 'SESSION_BUSY', error: 'untranslated host text' }, 409) : response(status()) });
  h.connect(); await tick(); assert.equal(await h.controller.reset(), false);
  assert.ok(h.controller.getSnapshot().message.startsWith(h.translate('code.SESSION_BUSY')));
  assert.doesNotMatch(h.controller.getSnapshot().message, /untranslated/);
  assert.equal(h.controller.getSnapshot().phase, 'error'); assert.equal(h.calls.filter((call) => call.init.method === 'POST').length, 1);
});

test('unknown HTTP error shows only safe code and status, not arbitrary Host message or token', async (t) => {
  const h = setup(t, { fetch: async () => response({ code: 'HOST_NEW_ERROR', error: csrf(4), message: '<img src=x onerror=alert(1)>' }, 409) });
  h.connect(); await tick(); const message = h.controller.getSnapshot().message;
  assert.match(message, /HOST_NEW_ERROR/); assert.match(message, /409/);
  assert.equal(message.includes(csrf(4)), false); assert.doesNotMatch(message, /<img/);
});

test('POST network uncertainty is explicit and never auto-retried', async (t) => {
  const h = setup(t, { fetch: async (call) => {
    if (call.init.method === 'POST') throw Error('connection lost'); return response(status());
  } });
  h.connect(); await tick(); assert.equal(await h.controller.reset(), false);
  assert.equal(h.controller.getSnapshot().phase, 'error'); assert.match(h.controller.getSnapshot().message, /结果未确认/);
  assert.equal(await h.controller.reset(), false); await h.controller.refresh();
  assert.equal(h.calls.filter((call) => call.init.method === 'POST').length, 1);
});

for (const [name, changes] of [
  ['missing API version', { apiVersion: undefined }], ['old API version', { apiVersion: 1 }], ['future API version', { apiVersion: 3 }],
  ['other session', { sessionId: 'B' }], ['other operation', { operationId: operation(2) }], ['missing operation', { operationId: undefined }],
  ['missing added count', { addedCount: undefined }], ['missing cumulative count', { resetCount: undefined }],
  ['negative added count', { addedCount: -1 }], ['fractional added count', { addedCount: 1.5 }],
  ['unsafe added count', { addedCount: Number.MAX_SAFE_INTEGER + 1 }], ['string count', { resetCount: '3' }],
  ['regressed cumulative count', { resetCount: 1 }], ['false changed with additions', { changed: false, addedCount: 1 }],
  ['true changed without additions', { changed: true, addedCount: 0 }], ['non-boolean changed', { changed: 'true' }],
  ['missing target sessions', { sessions: undefined }], ['empty target sessions', { sessions: [] }],
  ['missing root in targets', { sessions: ['B'] }], ['duplicate targets', { sessions: ['A', 'A'] }],
  ['non-string target', { sessions: ['A', null] }], ['refused result', { ok: false, code: 'RESET_FAILED' }],
]) {
  test(`POST ${name} is not success and is never automatically replayed`, async (t) => {
    const h = setup(t, { fetch: async (call) => call.init.method === 'POST' ? success(changes) : response(status()) });
    h.connect(); await tick(); assert.equal(await h.controller.reset(), false);
    assert.equal(h.controller.getSnapshot().kind, 'error'); assert.equal(h.controller.getSnapshot().ready, false);
    assert.equal(h.controller.getSnapshot().resetCount, 2); assert.match(h.controller.getSnapshot().message, /结果未确认/);
    await h.controller.refresh(); assert.equal(h.calls.filter((call) => call.init.method === 'POST').length, 1);
  });
}

test('real v2 no-op keeps the root cumulative count instead of showing zero additions as its count', async (t) => {
  const h = setup(t, { fetch: async (call) => call.init.method === 'POST'
    ? success({ changed: false, addedCount: 0, resetCount: 12 }) : response(status({ resetCount: 12 })) });
  h.connect(); await tick(); assert.equal(await h.controller.reset(), true);
  assert.match(h.controller.getSnapshot().message, /没有新增/); assert.match(h.controller.getSnapshot().message, /12/);
  assert.equal(h.controller.getSnapshot().addedCount, 0); assert.equal(h.controller.getSnapshot().resetCount, 12);
  assert.equal(h.calls.length, 3, 'successful reset does not need another GET to repair its count');
});

test('whole-tree additions and root cumulative count are distinct and both displayed truthfully', async (t) => {
  const h = setup(t, { fetch: async (call) => call.init.method === 'POST'
    ? success({ sessions: ['A', 'child', 'grandchild'], addedCount: 8, resetCount: 3 }) : response(status({ resetCount: 2 })) });
  h.connect(); await tick(); assert.equal(await h.controller.reset(), true);
  assert.equal(h.controller.getSnapshot().addedCount, 8); assert.equal(h.controller.getSnapshot().resetCount, 3);
  assert.match(h.controller.getSnapshot().message, /8/); assert.match(h.controller.getSnapshot().message, /3/);
  assert.doesNotMatch(h.controller.getSnapshot().message, /不应依赖/);
});

test('child-only additions may leave the root count zero', async (t) => {
  const h = setup(t, { fetch: async (call) => call.init.method === 'POST'
    ? success({ sessions: ['A', 'child'], addedCount: 8, resetCount: 0 }) : response(status({ resetCount: 0 })) });
  h.connect(); await tick(); assert.equal(await h.controller.reset(), true);
  assert.equal(h.controller.getSnapshot().resetCount, 0); assert.equal(h.controller.getSnapshot().addedCount, 8);
});

test('concurrent committed marks may increase cumulative count even when this operation adds nothing', async (t) => {
  const h = setup(t, { fetch: async (call) => call.init.method === 'POST'
    ? success({ changed: false, addedCount: 0, resetCount: 5 }) : response(status({ resetCount: 2 })) });
  h.connect(); await tick(); assert.equal(await h.controller.reset(), true); assert.equal(h.controller.getSnapshot().resetCount, 5);
});

for (const [name, factory] of [
  ['generation failure', () => { throw Error('no crypto'); }], ['invalid UUID', () => 'operation-not-a-uuid'], ['empty UUID', () => ''],
]) {
  test(`operation-id ${name} does not send POST`, async (t) => {
    const h = setup(t, { operationId: factory }); h.connect(); await tick();
    assert.equal(await h.controller.reset(), false); assert.equal(h.calls.length, 2);
    assert.match(h.controller.getSnapshot().message, /未发送重置请求/);
  });
}

test('default request timeout is 45 seconds for status, preflight and reset', async (t) => {
  const timers = [];
  const { api } = load({}, { setTimeout(callback, delay) { const timer = { callback, delay, cleared: false }; timers.push(timer); return timer; },
    clearTimeout(timer) { timer.cleared = true; } });
  const locale = makeLocale();
  const controller = api.createResetController({ sessionId: 'A', locale, t: locale.bind(api.LOCALE_NS),
    getGuard: () => ({ active: true, busy: false }), subscribeGuard: () => () => {}, operationId: () => operation(),
    fetch: async (url, init) => init.method === 'POST' ? success() : response(status()),
  });
  t.after(() => controller.dispose()); controller.connect(); await tick();
  assert.equal(await controller.reset(), true); assert.deepEqual(timers.map((timer) => timer.delay), [45000, 45000, 45000]);
  assert.ok(timers.every((timer) => timer.cleared));
});

test('status timeout releases the UI and makes only one request', async (t) => {
  const finished = deferred();
  const h = setup(t, { timeoutMs: 5, fetch: (call) => new Promise((resolve, reject) => {
    call.init.signal.addEventListener('abort', () => { const error = new Error('timed out'); error.name = 'AbortError'; reject(error); }, { once: true });
  }) });
  h.controller.subscribe(() => { if (h.controller.getSnapshot().phase === 'error') finished.resolve(); });
  h.connect(); await finished.promise; assert.match(h.controller.getSnapshot().message, /超时/); assert.equal(h.calls.length, 1);
});

test('native guard uses public mainView retention, binding identity, running and pending interaction', () => {
  let generation, state = { running: false, removed: false }, retainedBy = { mainView: 1 }, pending = new Map();
  const binding = { session: { getSnapshot: () => state } }; generation = binding;
  const ctx = { sessions: { binding: () => generation, retainInfo: () => ({ getSnapshot: () => ({ retainedBy }) }) },
    uiSession: { sessionStatus: { getSnapshot: () => pending } } };
  assert.equal(api.nativeGuard(ctx, 'A', binding).active, true);
  retainedBy = { mainView: 0 }; assert.equal(api.nativeGuard(ctx, 'A', binding).active, false);
  retainedBy = { mainView: 1 }; generation = {}; assert.equal(api.nativeGuard(ctx, 'A', binding).active, false);
  generation = binding; state = { running: true }; assert.equal(api.nativeGuard(ctx, 'A', binding).busy, true);
  state = { running: false, removed: true }; assert.equal(api.nativeGuard(ctx, 'A', binding).active, false);
  state = {}; assert.equal(api.nativeGuard(ctx, 'A', binding).active, false);
  state = { running: false }; pending = new Map([['A', { pendingInteraction: {} }]]);
  assert.equal(api.nativeGuard(ctx, 'A', binding).busy, true);
  pending = new Map([['A', { pendingInteraction: undefined }]]); assert.equal(api.nativeGuard(ctx, 'A', binding).busy, false);
  for (const bad of [{}, { mainView: -1 }, { mainView: '1' }, { mainView: 1.5 }, { mainView: Infinity }, Object.create({ mainView: 1 })]) {
    retainedBy = bad; assert.equal(api.nativeGuard(ctx, 'A', binding).active, false);
  }
});

test('busy-to-idle transition during POST keeps the control in its disabled pending phase', async (t) => {
  const pending = deferred();
  const h = setup(t, { fetch: (call) => call.init.method === 'POST' ? pending.promise : Promise.resolve(response(status())) });
  h.connect(); await tick(); const resetting = h.controller.reset(); await tick();
  h.change({ busy: true }); h.change({ busy: false });
  assert.equal(h.controller.getSnapshot().phase, 'resetting'); assert.equal(await h.controller.reset(), false);
  pending.resolve(success()); await resetting; await tick();
  assert.equal(h.calls.filter((call) => call.init.method === 'POST').length, 1);
});

for (const first of ['root', 'binding']) {
  test(`${first}-first disposal releases binding effects, native sources and locale subscriptions exactly once`, async (t) => {
    const h = applyHarness(); t.after(() => h.dispose());
    const controller = h.controller(); assert.equal(h.controller(), controller);
    controller.connect(); await tick();
    assert.equal(h.binding.session.listeners.size, 1); assert.equal(h.retention.listeners.size, 1);
    assert.equal(h.pending.listeners.size, 1); assert.equal(h.locale.listeners.size, 1); assert.equal(h.calls.length, 1);
    if (first === 'root') { h.root.dispose(); h.binding.ctx.dispose(); }
    else { h.binding.ctx.dispose(); h.root.dispose(); }
    assert.equal(h.binding.session.listeners.size, 0); assert.equal(h.retention.listeners.size, 0);
    assert.equal(h.pending.listeners.size, 0); assert.equal(h.locale.listeners.size, 0); assert.equal(h.binding.ctx.releases, 1);
    assert.equal(await controller.reset(), false);
    h.root.dispose(); h.binding.ctx.dispose(); assert.equal(h.binding.ctx.releases, 1);
  });
}

test('replacement binding gets a new controller while retaining the same public retainInfo source', async (t) => {
  const h = applyHarness(); t.after(() => h.dispose());
  const original = h.controller(); original.connect(); await tick();
  const previousBinding = h.binding; previousBinding.ctx.dispose(); h.replaceBinding();
  const next = h.controller(); assert.notEqual(next, original); next.connect(); await tick();
  assert.equal(h.retention.listeners.size, 1); assert.equal(h.calls.length, 2);
  assert.equal(await original.reset(), false); assert.equal(next.getSnapshot().ready, true);
});

test('public retention is synchronously reread before POST even with delayed notification', async (t) => {
  const pending = deferred();
  const h = applyHarness({ fetch: (call, n) => n === 2 ? pending.promise : Promise.resolve(response(status())) });
  t.after(() => h.dispose()); const controller = h.controller(); controller.connect(); await tick();
  const resetting = controller.reset(); h.retention.set({ retainedBy: { mainView: 0 } }, false);
  pending.resolve(response(status())); assert.equal(await resetting, false);
  assert.ok(h.calls.every((call) => call.init.method === 'GET')); assert.equal(controller.getSnapshot().canCheck, false);
});

test('public retain A-to-B-to-A notifications invalidate the original preflight epoch', async (t) => {
  const pending = deferred();
  const h = applyHarness({ fetch: (call, n) => n === 2 ? pending.promise : Promise.resolve(response(status())) });
  t.after(() => h.dispose()); const controller = h.controller(); controller.connect(); await tick();
  const resetting = controller.reset(); h.retention.set({ retainedBy: { mainView: 0 } }); h.retention.set({ retainedBy: { mainView: 1 } });
  pending.resolve(response(status())); assert.equal(await resetting, false); await tick();
  assert.ok(h.calls.every((call) => call.init.method === 'GET')); assert.equal(controller.getSnapshot().ready, true);
});

test('partial native subscription failure unwinds already acquired subscriptions and performs no I/O', async (t) => {
  const h = applyHarness(); t.after(() => h.dispose());
  h.retention.subscribe = () => { throw Error('subscription unavailable'); };
  const controller = h.controller(); controller.connect();
  assert.equal(h.binding.session.listeners.size, 0); assert.equal(h.pending.listeners.size, 0); assert.equal(h.locale.listeners.size, 0);
  assert.equal(h.calls.length, 0); assert.equal(controller.getSnapshot().phase, 'error'); assert.equal(controller.getSnapshot().canCheck, false);
});

test('language and dictionary revisions re-render ready status without GET or POST', async (t) => {
  const h = setup(t); h.connect(); await tick(); const before = h.controller.getSnapshot();
  assert.equal(before.reason, h.translate('code.READY'));
  h.locale.setLocale('en'); const after = h.controller.getSnapshot();
  assert.notEqual(before, after); assert.match(after.reason, /Manually/); assert.equal(h.calls.length, 1);
  h.locale.refreshDictionary(); assert.equal(h.calls.length, 1);
  assert.equal(after.resetCount, h.controller.getSnapshot().resetCount);
});

for (const changed of [true, false]) {
  test(`language switch retranslates an already displayed ${changed ? 'success' : 'no-op'} without I/O`, async (t) => {
    const h = setup(t, { fetch: async (call) => call.init.method === 'POST'
      ? success({ changed, addedCount: changed ? 4 : 0, resetCount: 12, sessions: ['A', 'child'] }) : response(status({ resetCount: 12 })) });
    h.connect(); await tick(); assert.equal(await h.controller.reset(), true);
    assert.match(h.controller.getSnapshot().message, changed ? /已新增/ : /没有新增/);
    h.locale.setLocale('en'); const result = h.controller.getSnapshot();
    assert.match(result.message, changed ? /Marked 4/ : /No additional/); assert.match(result.message, /12/);
    assert.equal(h.calls.length, 3); assert.equal(result.resetCount, 12);
  });
}

test('language switch retranslates an existing Host error without GET or POST', async (t) => {
  const h = setup(t, { fetch: async () => response({ apiVersion: 2, ok: false, code: 'POLICY_LOAD_FAILED', error: '宿主汉字不应显示' }, 503) });
  h.connect(); await tick(); assert.match(h.controller.getSnapshot().message, /策略读取失败/);
  h.locale.setLocale('en'); assert.match(h.controller.getSnapshot().message, /could not be loaded/);
  assert.equal(h.calls.length, 1); assert.doesNotMatch(h.controller.getSnapshot().message, /宿主汉字/);
});

test('language switch retranslates nested POST uncertainty detail without replaying the request', async (t) => {
  const h = setup(t, { fetch: async (call) => call.init.method === 'POST'
    ? response({ apiVersion: 2, ok: false, code: 'STORAGE_WRITE_FAILED' }, 409) : response(status()) });
  h.connect(); await tick(); assert.equal(await h.controller.reset(), false); assert.match(h.controller.getSnapshot().message, /结果未确认/);
  h.locale.setLocale('en'); const result = h.controller.getSnapshot();
  assert.match(result.message, /durable replay reset storage/); assert.match(result.message, /result is unconfirmed/);
  assert.equal(h.calls.length, 3); assert.equal(h.calls.filter((call) => call.init.method === 'POST').length, 1);
});

test('language switch during preflight does not invalidate epoch, abort or repeat requests', async (t) => {
  const pending = deferred();
  const h = setup(t, { fetch: (call, n) => n === 2 ? pending.promise : Promise.resolve(call.init.method === 'POST' ? success() : response(status())) });
  h.connect(); await tick(); const resetting = h.controller.reset(); h.locale.setLocale('en');
  assert.equal(h.calls[1].init.signal.aborted, false); assert.equal(h.calls.length, 2);
  pending.resolve(response(status())); assert.equal(await resetting, true);
  assert.match(h.controller.getSnapshot().message, /Marked/);
  assert.deepEqual(h.calls.map((call) => call.init.method), ['GET', 'GET', 'POST']);
});

test('UI is a localized non-submit accessible native-slot control; errors remain React text', () => {
  let mounted, resets = 0, refreshes = 0;
  let snapshot = { phase: 'idle', supported: true, ready: true, busy: false, canCheck: true, reason: 'ready', resetCount: 7 };
  const react = { useSyncExternalStore: (subscribe, getSnapshot) => getSnapshot(), useEffect: (fn) => { mounted = fn; },
    createElement: (type, props, ...children) => ({ type, props, children }) };
  const { api } = load(react); const locale = makeLocale(); const t = locale.bind(api.LOCALE_NS);
  const controller = { getSnapshot: () => snapshot, subscribe() {}, connect() {}, reset() { resets++; }, refresh() { refreshes++; }, dismiss() {} };
  let tree = api.ResetButton({ controller, t }), button = tree.children.find((child) => child?.type === 'button');
  assert.equal(typeof mounted, 'function'); assert.equal(button.props.type, 'button'); assert.equal(button.props.disabled, false);
  assert.equal(button.props['aria-label'], '重置旧回放'); assert.match(button.props.title, /7/);
  let stopped = false, prevented = false;
  button.props.onClick({ stopPropagation() { stopped = true; }, preventDefault() { prevented = true; } });
  assert.equal(resets, 1); assert.ok(stopped && prevented);
  snapshot = { ...snapshot, phase: 'resetting' }; tree = api.ResetButton({ controller, t }); button = tree.children.find((child) => child?.type === 'button');
  assert.equal(button.props.disabled, true); assert.equal(button.props['aria-busy'], true);
  locale.setLocale('en'); tree = api.ResetButton({ controller, t }); button = tree.children.find((child) => child?.type === 'button');
  assert.equal(button.props['aria-label'], 'Resetting…');
  snapshot = { ...snapshot, phase: 'error', ready: false, kind: 'error', message: '<img src=x onerror=alert(1)>' };
  tree = api.ResetButton({ controller, t }); button = tree.children.find((child) => child?.type === 'button');
  assert.equal(button.props['aria-label'], 'Retry checking');
  button.props.onClick({ stopPropagation() {}, preventDefault() {} }); assert.equal(refreshes, 1); assert.equal(resets, 1);
  const notice = tree.children.find((child) => child?.props?.role === 'alert');
  assert.equal(notice.children[0], snapshot.message); assert.equal(notice.props.dangerouslySetInnerHTML, undefined);
  const dismiss = notice.children.find((child) => child?.type === 'button');
  assert.equal(dismiss.props['aria-label'], 'Dismiss replay reset notice'); assert.equal(dismiss.children[0], 'Close');
  const styles = tree.children.find((child) => child?.type === 'style').children[0];
  assert.doesNotMatch(styles, /#[a-f\d]{3,8}\b|rgba?\(|business|specific-menu|interactive-bg-hover|--dsw-radius|--dsh-content/);
  assert.match(styles, /--dsw-alias-brand-primary/); assert.match(styles, /max-width:560px/);
});

test('binding disposal during POST keeps the cross-generation lock until its uncertain result settles', async (t) => {
  const pending = deferred();
  const h = applyHarness({ fetch: (call) => call.init.method === 'POST' ? pending.promise : Promise.resolve(response(status())) });
  t.after(() => h.dispose());
  const original = h.controller(); original.connect(); await tick();
  const resetting = original.reset(); await tick();
  const post = h.calls.find((call) => call.init.method === 'POST');
  h.binding.ctx.dispose(); assert.equal(post.init.signal.aborted, true);
  h.replaceBinding(); const next = h.controller(); next.connect(); await tick();
  assert.equal(next.getSnapshot().phase, 'resetting'); assert.equal(h.calls.length, 3);
  assert.equal(await next.reset(), false);
  pending.resolve(success()); assert.equal(await resetting, false); await tick();
  assert.equal(next.getSnapshot().ready, true);
  assert.deepEqual(h.calls.map((call) => call.init.method), ['GET', 'GET', 'POST', 'GET']);
});

for (const code of ['READY', 'BUSY', 'CLIENT_INVALID_JSON']) {
  test(`HTTP failure cannot masquerade as a local/status message with code ${code}`, async (t) => {
    const h = setup(t, { language: 'en', fetch: async () => response({ code, error: 'untrusted text' }, 409) });
    h.connect(); await tick();
    assert.match(h.controller.getSnapshot().message, /rejected the request/);
    assert.match(h.controller.getSnapshot().message, /409/);
    assert.doesNotMatch(h.controller.getSnapshot().message, /untrusted|\{status\}/);
    assert.equal(await h.controller.reset(), false);
  });
}

test('English and Chinese runtime dictionaries have identical keys and named placeholders', () => {
  assert.deepEqual(Object.keys(api.DICTIONARIES.en).sort(), Object.keys(api.DICTIONARIES.zh).sort());
  for (const key of Object.keys(api.DICTIONARIES.en)) {
    assert.equal(typeof api.DICTIONARIES.en[key], 'string'); assert.equal(typeof api.DICTIONARIES.zh[key], 'string');
    const placeholders = (value) => [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
    assert.deepEqual(placeholders(api.DICTIONARIES.en[key]), placeholders(api.DICTIONARIES.zh[key]), key);
    assert.doesNotMatch(api.DICTIONARIES.en[key] + api.DICTIONARIES.zh[key], /[\u200b\ufeff]/);
  }
});
