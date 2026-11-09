import {randomBytes, timingSafeEqual} from 'node:crypto';
import {LlmRuntime, isAgentLoopRequest, markAgentLoopRequest} from '@deepseek-ai/dsh-llm';
import {deriveEventMessage, foldSurface} from '@deepseek-ai/dsh-session';
import {defineDomain, domainTable} from '@deepseek-ai/dsh-storage-domain';
import {z} from 'zod';
import {EMPTY_POLICY, validatePolicy, createProjector} from './policy.js';
import {installBridge} from './host-bridge.js';
import {ResetCoordinator} from './coordinator.js';
import {API_VERSION, ReplayResetError, errorCode, errorMessage} from './errors.js';

export const name = 'dsh-replay-reset';
export const inject = ['llm', 'sessions', 'agents', 'sessionQuery', 'sessionPersistence', 'subagents', 'storageDomain', 'webServer'];
const BASE = '/plugins/replay-reset';
const providers = ['agentrouter'];
const spec = defineDomain({name: 'replay_reset', version: 1, layout: 'single', tables: {
  state: domainTable(z.unknown().transform(validatePolicy)),
}});

function reply(res, status, body) {
  if (res.destroyed || res.writableEnded) return;
  res.writeHead(status, {'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff'});
  res.end(JSON.stringify(body));
}
function reject(res, status, code, message) {
  return reply(res, status, {apiVersion: API_VERSION, ok: false, code, error: message});
}
function validId(value) {
  return typeof value === 'string' && /^[a-zA-Z0-9_-]{1,160}$/.test(value);
}
function validOperationId(value) {
  return typeof value === 'string' && /^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(value);
}
function sameOrigin(req) {
  if (req.headers['sec-fetch-site'] === 'cross-site') return false;
  const origin = req.headers.origin;
  if (origin === undefined || origin === 'dsh-app://app') return true;
  if (typeof origin !== 'string') return false;
  try {
    const parsed = new URL(origin);
    return (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      !parsed.username && !parsed.password && parsed.host === req.headers.host;
  } catch { return false; }
}
function validCsrf(supplied, expected) {
  // UTF-16 character count is not byte count. Admit the exact ASCII token shape
  // before timingSafeEqual, including duplicated/array and non-ASCII headers.
  return typeof supplied === 'string' && /^[a-f0-9]{64}$/.test(supplied) &&
    timingSafeEqual(Buffer.from(supplied, 'ascii'), Buffer.from(expected, 'ascii'));
}
async function bodyOf(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += bytes.length;
    if (size > 8192) throw new ReplayResetError('REQUEST_TOO_LARGE', '请求过大');
    chunks.push(bytes);
  }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch (error) { throw new ReplayResetError('INVALID_BODY', '需要有效的 JSON 对象', {cause: error}); }
}

export function apply(ctx) {
  const lifetime = new AbortController();
  const readiness = Promise.withResolvers();
  readiness.promise.catch(() => {});
  let domain, table, coordinator, bridgeDispose, removeRoute, failure;
  let ready = false;
  let closing = false;
  let loading = Promise.resolve();
  let cleanupPromise, domainClosePromise;
  const csrf = randomBytes(32).toString('hex');
  const log = (level, message) => {
    // A diagnostic failure must not interrupt rollback or late-handle cleanup.
    try { ctx.logger[level](message); } catch {}
  };
  function closeDomain() {
    if (!domain) return Promise.resolve();
    return domainClosePromise ??= Promise.resolve().then(() => domain.close());
  }
  function detachBridge() {
    const dispose = bridgeDispose;
    bridgeDispose = undefined;
    dispose?.();
  }
  function cleanup() {
    if (cleanupPromise) return cleanupPromise;
    const completion = Promise.withResolvers();
    cleanupPromise = completion.promise;
    cleanupPromise.catch(() => {});
    closing = true;
    ready = false;
    const reason = new ReplayResetError('PLUGIN_STOPPED', '旧回放重置插件已卸载');
    lifetime.abort(reason);
    readiness.reject(reason);
    const errors = [];
    try { removeRoute?.(); } catch (error) { errors.push(error); }
    // Stop all state reads immediately, even if a route disposer or a storage
    // open fails/stalls. Already admitted commits remain maintenance-locked.
    try { detachBridge(); } catch (error) { errors.push(error); }
    const gate = coordinator?.gate();
    const drainInitialization = domain ? loading : undefined;
    void (async () => {
      try { if (gate) await gate; } catch (error) { errors.push(error); }
      try { if (drainInitialization) await drainInitialization; } catch (error) { errors.push(error); }
      try { await closeDomain(); } catch (error) { errors.push(error); }
      if (errors.length) throw new AggregateError(errors, '旧回放重置资源清理未全部成功');
    })().then(completion.resolve, completion.reject);
    return cleanupPromise;
  }

  const projectForSession = createProjector(() => table.get('policy'), id => ctx.sessions.get(id));
  const project = options => !closing && !failure && providers.includes(options.provider) ? projectForSession(options) : options;
  const handler = async (req, res) => {
    try {
      const connection = ctx.get('connection');
      if (!connection?.admit) return reject(res, 503, 'AUTH_UNAVAILABLE', '宿主鉴权尚未就绪');
      const admission = connection.admit(req);
      if ('rejection' in admission) return reject(res, admission.rejection,
        admission.rejection === 401 ? 'AUTH_REQUIRED' : 'AUTH_REJECTED', '请返回 DSH 登录');
      if (closing) return reject(res, 503, 'PLUGIN_STOPPED', '旧回放重置插件已卸载');
      const url = new URL(req.url, 'http://localhost');
      if (url.pathname === BASE + '/status' && req.method === 'GET') {
        const sessionId = url.searchParams.get('sessionId');
        if (!validId(sessionId)) return reject(res, 400, 'INVALID_SESSION_ID', '会话 ID 无效');
        if (!ready) return reply(res, 200, {apiVersion: API_VERSION, sessionId, csrf,
          supported: !failure, ready: false, busy: false, reasonCode: failure?.code ?? 'LOADING',
          reason: failure?.message ?? '正在加载重置策略', resetCount: 0});
        const result = await coordinator.status(sessionId,
          AbortSignal.any([lifetime.signal, AbortSignal.timeout(10000)]));
        if (closing) return reject(res, 503, 'PLUGIN_STOPPED', '旧回放重置插件已卸载');
        return reply(res, 200, {...result, csrf});
      }
      if (url.pathname !== BASE + '/reset' || req.method !== 'POST') {
        return reject(res, 404, 'NOT_FOUND', '接口不存在');
      }
      if (!sameOrigin(req)) return reject(res, 403, 'ORIGIN_REJECTED', '只允许当前 DSH 界面操作');
      if (!validCsrf(req.headers['x-replay-reset-csrf'], csrf)) {
        return reject(res, 403, 'CSRF_EXPIRED', '界面凭证过期，请重新点击');
      }
      if (!String(req.headers['content-type']).toLowerCase().startsWith('application/json')) {
        return reject(res, 415, 'JSON_REQUIRED', '需要 JSON 请求');
      }
      if (!ready) return reject(res, 503, failure?.code ?? 'LOADING', failure?.message ?? '插件尚未就绪');
      const body = await bodyOf(req);
      lifetime.signal.throwIfAborted();
      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return reject(res, 400, 'INVALID_BODY', '需要有效的 JSON 对象');
      }
      if (!validId(body.sessionId)) return reject(res, 400, 'INVALID_SESSION_ID', '会话 ID 无效');
      if (!validOperationId(body.operationId)) return reject(res, 400, 'INVALID_OPERATION_ID', '操作标识无效');
      const result = await coordinator.reset(body.sessionId, body.operationId);
      log('info', `旧回放标记已提交：session=${body.sessionId} affected=${result.sessions.length} added=${result.addedCount} marked=${result.resetCount}`);
      if (closing) return reject(res, 503, 'PLUGIN_STOPPED', '插件已卸载；已送达的提交可能已完成，请先检查状态');
      return reply(res, 200, result);
    } catch (error) {
      log('warn', '重置未完成：' + errorMessage(error));
      const code = errorCode(error);
      const status = code === 'INVALID_BODY' ? 400 : code === 'REQUEST_TOO_LARGE' ? 413 : 409;
      return reject(res, status, code, errorMessage(error));
    }
  };

  // Own teardown before acquiring anything. Route registration is deliberately
  // first: a duplicate route cannot leave a bridge or pending domain open.
  ctx.effect(() => cleanup);
  try { removeRoute = ctx.webServer.register({kind: 'prefix', path: BASE, handler}); }
  catch (error) {
    void cleanup().catch(cleanupError => log('error', errorMessage(cleanupError)));
    throw error;
  }
  try {
    if (!LlmRuntime.prototype.isPrototypeOf(ctx.llm)) {
      throw new ReplayResetError('HOST_MODULE_MISMATCH', 'LLM 模块与当前宿主实例不一致，未安装重置桥');
    }
    bridgeDispose = installBridge({prototype: LlmRuntime.prototype, project,
      isMarked: isAgentLoopRequest, mark: markAgentLoopRequest,
      getGate: options => !closing && providers.includes(options.provider) ?
        (!ready ? readiness.promise : coordinator?.gate()) : undefined,
      warn: message => log('warn', message)});
  } catch (error) {
    failure = {code: errorCode(error, 'BRIDGE_INSTALL_FAILED'), message: errorMessage(error)};
    readiness.reject(error);
    log('warn', failure.message);
  }
  if (failure) return;

  loading = (async () => {
    try {
      domain = await ctx.storageDomain.open(spec);
      // open() has no cancellation parameter. An open that resolves after
      // teardown is closed here, without initializing, publishing, or rearming.
      if (closing) { await closeDomain(); return; }
      table = domain.table('state');
      if (!table.get('policy')) await table.put('policy', EMPTY_POLICY);
      lifetime.signal.throwIfAborted();
      validatePolicy(table.get('policy'));
      coordinator = new ResetCoordinator({ctx, table, providers,
        derive: deriveEventMessage, foldSurface, lifetime: lifetime.signal});
      ready = true;
      readiness.resolve();
      log('info', '旧回放重置插件已就绪（手动一次、原始历史不变、请求接口指纹已核验）');
    } catch (error) {
      if (!closing) {
        failure = {code: 'POLICY_LOAD_FAILED', message: '重置策略读取失败：' + errorMessage(error)};
        readiness.reject(error);
        log('error', failure.message);
        try { detachBridge(); } catch (cleanupError) { log('error', errorMessage(cleanupError)); }
        try { await closeDomain(); } catch (cleanupError) { log('error', errorMessage(cleanupError)); }
      } else {
        log('warn', '已取消的策略加载：' + errorMessage(error));
      }
    }
  })();
  loading.catch(error => log('error', errorMessage(error)));
}
