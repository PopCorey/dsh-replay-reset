import test from 'node:test';
import assert from 'node:assert/strict';
import {installBridge, fingerprint} from '../src/host-bridge.js';

const OWNER = Symbol.for('dsh-replay-reset.adapter-bridge.v1');
const deferred = () => Promise.withResolvers();
async function* native(options, prepared) {
  this.calls++;
  this.seen = {options, prepared};
  yield {type: 'finish', reason: {kind: 'stop'}};
}
function prototypeOf() {
  const prototype = Object.create(null);
  Object.defineProperty(prototype, 'adapterStream', {value: native,
    configurable: true, writable: true, enumerable: false});
  return prototype;
}
function fixture({getGate = () => undefined, project = options => options} = {}) {
  const prototype = prototypeOf();
  const marks = new WeakSet();
  const runtime = Object.assign(Object.create(prototype), {calls: 0});
  const options = Object.freeze({provider: 'agentrouter', model: 'synthetic', sessionId: 'root',
    messages: Object.freeze([]), signal: new AbortController().signal});
  marks.add(options);
  const dispose = installBridge({prototype, expected: fingerprint(native),
    project, getGate, isMarked: value => marks.has(value), mark: value => marks.add(value)});
  return {prototype, runtime, options, marks, dispose};
}
const unsupported = error => error.code === 'BRIDGE_UNSUPPORTED';
const duplicate = error => error.code === 'BRIDGE_DUPLICATE';

// These tests need no DSH installation: the real fingerprint/serializer tests
// remain in host.test.mjs and are run by the complete offline suite.
test('non-extensible prototypes refuse installation before either write', () => {
  const prototype = prototypeOf();
  const before = Object.getOwnPropertyDescriptor(prototype, 'adapterStream');
  Object.preventExtensions(prototype);
  assert.throws(() => installBridge({prototype, expected: fingerprint(native)}), unsupported);
  assert.deepEqual(Object.getOwnPropertyDescriptor(prototype, 'adapterStream'), before);
  assert.equal(Object.hasOwn(prototype, OWNER), false);
});

for (const inherited of [false, true]) {
  test(`a ${inherited ? 'inherited' : 'own'} falsy reserved marker is not overwritten`, () => {
    const owner = Object.create(null);
    Object.defineProperty(owner, OWNER, {value: false, configurable: false});
    const prototype = inherited ? Object.create(owner) : owner;
    Object.defineProperty(prototype, 'adapterStream', {value: native, configurable: true});
    const before = Object.getOwnPropertyDescriptor(prototype, 'adapterStream');
    assert.throws(() => installBridge({prototype, expected: fingerprint(native)}), duplicate);
    assert.deepEqual(Object.getOwnPropertyDescriptor(prototype, 'adapterStream'), before);
    assert.equal(owner[OWNER], false);
  });
}

for (const scenario of ['marker-before', 'marker-after', 'method-before', 'method-after']) {
  test(`partial installation rolls back ${scenario} failure exactly`, () => {
    const target = prototypeOf();
    const before = Object.getOwnPropertyDescriptor(target, 'adapterStream');
    const marker = scenario.startsWith('marker');
    const applyFirst = scenario.endsWith('after');
    let failed = false;
    const fault = new Error('synthetic property write failed');
    const prototype = new Proxy(target, {
      defineProperty(object, key, descriptor) {
        if (!failed && key === (marker ? OWNER : 'adapterStream')) {
          failed = true;
          if (applyFirst) Reflect.defineProperty(object, key, descriptor);
          throw fault;
        }
        return Reflect.defineProperty(object, key, descriptor);
      },
    });
    assert.throws(() => installBridge({prototype, expected: fingerprint(native)}),
      error => error.code === 'BRIDGE_INSTALL_FAILED' && error.cause === fault);
    assert.deepEqual(Object.getOwnPropertyDescriptor(target, 'adapterStream'), before);
    assert.equal(Object.hasOwn(target, OWNER), false);
  });
}

test('ordinary disposal restores the complete descriptor and is idempotent', () => {
  const f = fixture();
  f.dispose();
  f.dispose();
  assert.deepEqual(Object.getOwnPropertyDescriptor(f.prototype, 'adapterStream'), {
    value: native, configurable: true, writable: true, enumerable: false,
  });
  assert.equal(Object.hasOwn(f.prototype, OWNER), false);
});

test('disposal releases an already waiting request without touching closed policy', async () => {
  const gate = deferred();
  let policyReads = 0;
  const f = fixture({getGate: () => gate.promise,
    project: () => { policyReads++; throw Error('closed policy must not be read'); }});
  const prepared = Object.freeze({generation: 'original'});
  const stream = f.runtime.adapterStream(f.options, prepared);
  const next = stream.next();
  await Promise.resolve();
  assert.equal(f.runtime.calls, 0);
  f.dispose();
  assert.equal((await next).value.reason.kind, 'stop');
  assert.equal(f.runtime.calls, 1);
  assert.equal(f.runtime.seen.options, f.options);
  assert.equal(f.runtime.seen.prepared, prepared);
  assert.equal(policyReads, 0);
  await stream.return();
  gate.resolve();
});

test('caller cancellation still wins while a request waits for maintenance', async () => {
  const gate = deferred();
  const f = fixture({getGate: () => gate.promise});
  const abort = new AbortController();
  const options = Object.freeze({...f.options, signal: abort.signal});
  f.marks.add(options);
  const reason = new Error('caller cancelled');
  const stream = f.runtime.adapterStream(options, {});
  const next = stream.next();
  const rejected = assert.rejects(next, error => error === reason);
  abort.abort(reason);
  await rejected;
  assert.equal(f.runtime.calls, 0);
  f.dispose();
  gate.resolve();
});

test('rejected readiness never dispatches before disposal', async () => {
  const gate = deferred();
  const f = fixture({getGate: () => gate.promise});
  const next = f.runtime.adapterStream(f.options, {}).next();
  const fault = new Error('policy unavailable');
  const rejected = assert.rejects(next, error => error === fault);
  gate.reject(fault);
  await rejected;
  assert.equal(f.runtime.calls, 0);
  f.dispose();
});

test('an unmarked request never reads the gate or policy', async () => {
  const f = fixture({getGate: () => { throw Error('must not read gate'); },
    project: () => { throw Error('must not read policy'); }});
  try {
    const options = {...f.options};
    for await (const chunk of f.runtime.adapterStream(options, {})) {
      assert.equal(chunk.reason.kind, 'stop');
    }
    assert.equal(f.runtime.seen.options, options);
  } finally { f.dispose(); }
});

test('a later wrapper keeps ownership and a disposed bridge is transparent', async () => {
  const f = fixture({getGate: () => { throw Error('disposed gate'); },
    project: () => { throw Error('disposed policy'); }});
  const bridge = f.prototype.adapterStream;
  const later = function (...args) { return bridge.apply(this, args); };
  Object.defineProperty(f.prototype, 'adapterStream', {value: later, configurable: true});
  f.dispose();
  assert.equal(f.prototype.adapterStream, later);
  for await (const chunk of f.runtime.adapterStream(f.options, {})) {
    assert.equal(chunk.reason.kind, 'stop');
  }
  assert.equal(f.runtime.calls, 1);
});
