import {test} from 'node:test';
import assert from 'node:assert/strict';
import {Readable} from 'node:stream';
import {apply} from '../src/index.js';
import {LlmRuntime, markAgentLoopRequest} from '@deepseek-ai/dsh-llm';
import {EMPTY_POLICY, identity} from '../src/policy.js';

const tick = () => new Promise(resolve => setImmediate(resolve));
const operationId = '11111111-1111-4111-8111-111111111111';
const OWNER = Symbol.for('dsh-replay-reset.adapter-bridge.v1');

async function harness(options = {}) {
  const {deny = false, loadingFailure = false, wrongInstance = false,
    registerFailure, removeFailure, closeFailure, openPromise, writePromise,
    initialMissing = false, sessionId = 'root', markedCount = 0} = options;
  let handler, dispose, activationError;
  let policy = initialMissing ? undefined : structuredClone(EMPTY_POLICY);
  const stats = {opens: 0, closes: 0, removes: 0, reads: 0, writesStarted: 0, writes: 0};
  const session = {id: sessionId, header: {id: sessionId, createdAt: 10, version: 4, isSeeded: false},
    inheritedEventCount: 0, seq: 1};
  const events = [{type: 'model/selection', seq: 0, time: 10,
    data: {provider: 'agentrouter', model: 'gpt-6-astra'}}];
  if (markedCount) {
    policy.sessions[sessionId] = {identity: identity(session.header, 0),
      header: {id: sessionId, createdAt: 10}, cutoff: 1, entries:
        Array.from({length: markedCount}, (_, index) => ({id: 'old-' + index,
          digest: 'a'.repeat(64), provider: 'agentrouter', model: 'gpt-6-astra'}))};
  }
  let closed = false;
  const table = {
    get() { stats.reads++; if (closed) throw Error('read after close'); return policy; },
    async put(key, value) {
      if (closed) throw Error('write after close');
      stats.writesStarted++;
      if (writePromise) await writePromise;
      if (closed) throw Error('closed during write');
      policy = value;
      stats.writes++;
    },
  };
  const domain = {table: () => table, async close() {
    stats.closes++;
    closed = true;
    if (closeFailure) throw closeFailure;
  }};
  const agent = {id: sessionId, status: 'idle', locked: false,
    model: {current: () => ({provider: 'agentrouter', model: 'gpt-6-astra'})},
    async runMaintenance(job) {
      if (this.status !== 'idle') throw Error('busy');
      this.locked = true;
      try { return await job(new AbortController().signal); }
      finally { this.locked = false; }
    },
  };
  const logs = [];
  const ctx = {llm: wrongInstance ? {} : Object.create(LlmRuntime.prototype),
    logger: {info: value => logs.push(value), warn: value => logs.push(value), error: value => logs.push(value)},
    get(name) { if (name === 'connection') return {admit: () => deny ? {rejection: 401} :
      {peer: {id: 'synthetic-owner', principal: {kind: 'owner'}}}}; },
    effect(fn) { dispose = fn(); },
    webServer: {register(spec) {
      if (registerFailure) throw registerFailure;
      handler = spec.handler;
      return () => { stats.removes++; if (removeFailure) throw removeFailure; };
    }},
    storageDomain: {async open() {
      stats.opens++;
      if (openPromise) await openPromise;
      if (loadingFailure) throw Error('simulated invalid policy');
      return domain;
    }},
    sessions: {get: id => id === sessionId ? session : undefined, messageProjections: []},
    agents: {get: id => id === sessionId ? agent : undefined},
    sessionQuery: {async observeSession() {
      return {header: session.header, inheritedEventCount: 0, events, [Symbol.dispose]() {}};
    }}, subagents: {async listDescendants() { return []; }},
  };
  const original = Object.getOwnPropertyDescriptor(LlmRuntime.prototype, 'adapterStream');
  try { apply(ctx); } catch (error) { activationError = error; }
  await tick();
  async function request(path, method = 'GET', body, headers = {}, rawBody) {
    assert.equal(typeof handler, 'function', 'route must have registered');
    const input = rawBody ?? (body === undefined ? undefined : JSON.stringify(body));
    const req = Readable.from(input === undefined ? [] : [Buffer.from(input)]);
    Object.assign(req, {url: path, method, headers: {host: 'localhost:1234', ...headers}});
    let status, result;
    await handler(req, {writeHead(code) { status = code; }, end(text) { result = JSON.parse(text); }});
    return {status, body: result};
  }
  return {request, ctx, agent, session, events, logs, stats, activationError,
    policy: () => policy, dispose: () => dispose(),
    close: async () => {
      try { await dispose(); }
      finally {
        assert.deepEqual(Object.getOwnPropertyDescriptor(LlmRuntime.prototype, 'adapterStream'), original);
        assert.equal(Object.hasOwn(LlmRuntime.prototype, OWNER), false);
      }
    },
  };
}
async function headersFor(h) {
  const status = await h.request('/plugins/replay-reset/status?sessionId=' + h.session.id);
  return {'content-type': 'application/json', 'x-replay-reset-csrf': status.body.csrf};
}
const bodyFor = h => ({sessionId: h.session.id, operationId});

test('host endpoints enforce auth, csrf, origin and one-click no-op without sending a message', async () => {
  const h = await harness();
  try {
    const status = await h.request('/plugins/replay-reset/status?sessionId=root');
    assert.equal(status.status, 200);
    assert.equal(status.body.apiVersion, 2);
    assert.equal(status.body.ready, true);
    assert.equal(status.body.reasonCode, 'READY');
    const body = bodyFor(h);
    assert.equal((await h.request('/plugins/replay-reset/reset', 'POST', body,
      {'content-type': 'application/json'})).status, 403);
    const headers = {'content-type': 'application/json', 'x-replay-reset-csrf': status.body.csrf};
    assert.equal((await h.request('/plugins/replay-reset/reset', 'POST', body,
      {...headers, origin: 'https://evil.invalid'})).status, 403);
    assert.equal(h.stats.writes, 0);
    const result = await h.request('/plugins/replay-reset/reset', 'POST', body, headers);
    assert.equal(result.status, 200);
    assert.equal(result.body.apiVersion, 2);
    assert.equal(result.body.sessionId, 'root');
    assert.equal(result.body.operationId, operationId);
    assert.equal(result.body.ok, true);
    assert.equal(result.body.changed, false);
    assert.equal(result.body.addedCount, 0);
    assert.equal(result.body.resetCount, 0);
    assert.equal(h.stats.writes, 1);
    await h.request('/plugins/replay-reset/reset', 'POST', body, headers);
    assert.equal(h.stats.writes, 1);
    assert.ok(!h.logs.some(value => value.includes(status.body.csrf)));
  } finally { await h.close(); }
});

test('unauthenticated calls never disclose status or csrf', async () => {
  const h = await harness({deny: true});
  try {
    const result = await h.request('/plugins/replay-reset/status?sessionId=root');
    assert.equal(result.status, 401);
    assert.equal(result.body.code, 'AUTH_REQUIRED');
    assert.equal(result.body.csrf, undefined);
    assert.equal(h.stats.writes, 0);
  } finally { await h.close(); }
});

test('wrong host module instance refuses to install a bridge or open storage', async () => {
  const h = await harness({wrongInstance: true});
  try {
    const result = await h.request('/plugins/replay-reset/status?sessionId=root');
    assert.equal(result.body.ready, false);
    assert.equal(result.body.reasonCode, 'HOST_MODULE_MISMATCH');
    assert.match(result.body.reason, /实例不一致/);
    assert.equal(h.stats.opens, 0);
  } finally { await h.close(); }
});

test('policy load failure keeps the button unavailable and rolls back the bridge', async () => {
  const original = LlmRuntime.prototype.adapterStream;
  const h = await harness({loadingFailure: true});
  try {
    const result = await h.request('/plugins/replay-reset/status?sessionId=root');
    assert.equal(result.body.ready, false);
    assert.equal(result.body.supported, false);
    assert.equal(result.body.reasonCode, 'POLICY_LOAD_FAILED');
    assert.match(result.body.reason, /读取失败/);
    assert.equal(LlmRuntime.prototype.adapterStream, original);
  } finally { await h.close(); }
});

test('route registration failure cannot leave a bridge or start a domain open', async () => {
  const fault = Error('synthetic duplicate route');
  const original = LlmRuntime.prototype.adapterStream;
  const h = await harness({registerFailure: fault});
  assert.equal(h.activationError, fault);
  assert.equal(h.stats.opens, 0);
  assert.equal(h.stats.writes, 0);
  assert.equal(LlmRuntime.prototype.adapterStream, original);
  await h.close();
});

test('throwing route teardown does not skip bridge removal or domain close', async () => {
  const h = await harness({removeFailure: Error('synthetic route removal failure')});
  const first = h.dispose();
  assert.equal(h.dispose(), first);
  await assert.rejects(first, error => error instanceof AggregateError && error.errors.length === 1);
  assert.equal(h.stats.removes, 1);
  assert.equal(h.stats.closes, 1);
  await assert.rejects(h.close(), AggregateError);
});

test('cleanup aggregates independent errors after attempting every resource', async () => {
  const h = await harness({removeFailure: Error('route removal failure'), closeFailure: Error('domain close failure')});
  await assert.rejects(h.close(), error => error instanceof AggregateError && error.errors.length === 2);
  assert.equal(h.stats.removes, 1);
  assert.equal(h.stats.closes, 1);
});

test('unload while opening storage closes the late handle without publishing ready', {timeout: 2000}, async () => {
  const opened = Promise.withResolvers();
  const h = await harness({openPromise: opened.promise});
  const options = markAgentLoopRequest({provider: 'agentrouter', model: 'gpt-6-astra',
    sessionId: 'root', messages: []});
  const next = h.ctx.llm.adapterStream(options).next();
  const rejected = assert.rejects(next, error => error.code === 'PLUGIN_STOPPED');
  await h.close();
  await rejected;
  assert.equal(h.stats.closes, 0);
  assert.equal(h.stats.reads, 0);
  opened.resolve();
  await tick();
  assert.equal(h.stats.closes, 1);
  assert.equal(h.stats.writes, 0);
  assert.equal(h.stats.reads, 0);
  assert.ok(!h.logs.some(value => value.includes('已就绪')));
  const result = await h.request('/plugins/replay-reset/status?sessionId=root');
  assert.equal(result.status, 503);
  assert.equal(result.body.code, 'PLUGIN_STOPPED');
  assert.equal(result.body.csrf, undefined);
});

test('unload drains an initial write but never rearms after it acknowledges', async () => {
  const write = Promise.withResolvers();
  const h = await harness({initialMissing: true, writePromise: write.promise});
  assert.equal(h.stats.writesStarted, 1);
  let closed = false;
  const closing = h.close().then(() => { closed = true; });
  await Promise.resolve();
  assert.equal(closed, false);
  assert.equal(h.stats.closes, 0);
  write.resolve();
  await closing;
  assert.equal(h.stats.writes, 1);
  assert.equal(h.stats.closes, 1);
  assert.ok(!h.logs.some(value => value.includes('已就绪')));
});

test('unload keeps storage open until an admitted durable reset drains', async () => {
  const write = Promise.withResolvers();
  const h = await harness({writePromise: write.promise});
  const headers = await headersFor(h);
  const resetting = h.request('/plugins/replay-reset/reset', 'POST', bodyFor(h), headers);
  await tick();
  assert.equal(h.stats.writesStarted, 1);
  assert.equal(h.agent.locked, true);
  const closing = h.close();
  assert.equal(h.stats.closes, 0);
  write.resolve();
  const result = await resetting;
  await closing;
  assert.equal(h.stats.writes, 1);
  assert.equal(h.stats.closes, 1);
  assert.equal(h.agent.locked, false);
  assert.equal(h.policy().operations.length, 1);
  assert.ok(['PLUGIN_STOPPED', 'CANCELLED'].includes(result.body.code));
});

for (const token of ['é'.repeat(64), 'f'.repeat(63), 'x'.repeat(64), ['f'.repeat(64), 'f'.repeat(64)]]) {
  test('invalid ASCII/byte/duplicate csrf headers return 403 rather than 409', async () => {
    const h = await harness();
    try {
      const result = await h.request('/plugins/replay-reset/reset', 'POST', bodyFor(h),
        {'content-type': 'application/json', 'x-replay-reset-csrf': token});
      assert.equal(result.status, 403);
      assert.equal(result.body.code, 'CSRF_EXPIRED');
      assert.equal(h.stats.writes, 0);
    } finally { await h.close(); }
  });
}

test('malformed origins are explicit security refusals and never write', async () => {
  const h = await harness();
  try {
    const headers = await headersFor(h);
    const result = await h.request('/plugins/replay-reset/reset', 'POST', bodyFor(h),
      {...headers, origin: 'not an origin'});
    assert.equal(result.status, 403);
    assert.equal(result.body.code, 'ORIGIN_REJECTED');
    assert.equal(h.stats.writes, 0);
  } finally { await h.close(); }
});

test('authenticated invalid JSON shapes and oversized bodies have precise status codes', async () => {
  const h = await harness();
  try {
    const headers = await headersFor(h);
    for (const value of [null, [], 'text', 1]) {
      const result = await h.request('/plugins/replay-reset/reset', 'POST', value, headers);
      assert.equal(result.status, 400);
      assert.equal(result.body.code, 'INVALID_BODY');
    }
    const malformed = await h.request('/plugins/replay-reset/reset', 'POST', undefined, headers, '{');
    assert.equal(malformed.status, 400);
    assert.equal(malformed.body.code, 'INVALID_BODY');
    const oversized = await h.request('/plugins/replay-reset/reset', 'POST', undefined, headers, ' '.repeat(8193));
    assert.equal(oversized.status, 413);
    assert.equal(oversized.body.code, 'REQUEST_TOO_LARGE');
    const invalidId = await h.request('/plugins/replay-reset/reset', 'POST',
      {...bodyFor(h), operationId: '-'.repeat(36)}, headers);
    assert.equal(invalidId.status, 400);
    assert.equal(invalidId.body.code, 'INVALID_OPERATION_ID');
    assert.equal(h.stats.writes, 0);
  } finally { await h.close(); }
});

test('HTTP no-op returns the existing root cumulative count, not zero added', async () => {
  const h = await harness({markedCount: 2});
  try {
    const headers = await headersFor(h);
    const result = await h.request('/plugins/replay-reset/reset', 'POST', bodyFor(h), headers);
    assert.equal(result.status, 200);
    assert.equal(result.body.changed, false);
    assert.equal(result.body.addedCount, 0);
    assert.equal(result.body.resetCount, 2);
    const status = await h.request('/plugins/replay-reset/status?sessionId=root');
    assert.equal(status.body.resetCount, 2);
  } finally { await h.close(); }
});

for (const sessionId of ['constructor', 'toString', '__proto__']) {
  test(`HTTP status/reset accept safe reserved-name session ID ${sessionId}`, async () => {
    const h = await harness({sessionId});
    try {
      const headers = await headersFor(h);
      const result = await h.request('/plugins/replay-reset/reset', 'POST', bodyFor(h), headers);
      assert.equal(result.status, 200);
      assert.equal(result.body.sessionId, sessionId);
      assert.equal(result.body.resetCount, 0);
      assert.equal(Object.hasOwn(h.policy().sessions, sessionId), true);
      assert.equal(Object.getPrototypeOf(h.policy().sessions), null);
    } finally { await h.close(); }
  });
}
