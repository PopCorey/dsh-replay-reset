import {createHash} from 'node:crypto';
import {ReplayResetError} from './errors.js';

export const HOST_FINGERPRINT = '172b682412648e88f5ee13fb5ca398f9486b7749d0f60743a31628807030eb8e';
const OWNER = Symbol.for('dsh-replay-reset.adapter-bridge.v1');

export function fingerprint(fn) {
  return createHash('sha256').update(Function.prototype.toString.call(fn)).digest('hex');
}

function waitGate(gate, signal) {
  if (!signal) return gate;
  signal.throwIfAborted();
  return new Promise((resolve, reject) => {
    const cleanup = () => signal.removeEventListener('abort', abort);
    const abort = () => { cleanup(); reject(signal.reason); };
    signal.addEventListener('abort', abort, {once: true});
    gate.then(value => { cleanup(); resolve(value); }, error => { cleanup(); reject(error); });
  });
}

/** Explicit, version-pinned internal seam; never re-enters llm.stream(). */
export function installBridge({prototype, project, getGate, isMarked, mark, expected = HOST_FINGERPRINT, warn = () => {}}) {
  // The reserved seat must be absent, not merely falsy. Do not replace another owner.
  if (OWNER in prototype) {
    throw new ReplayResetError('BRIDGE_DUPLICATE', '重置请求桥已安装或其标记被占用，拒绝重复装饰');
  }
  const descriptor = Object.getOwnPropertyDescriptor(prototype, 'adapterStream');
  if (!descriptor?.configurable || typeof descriptor.value !== 'function' ||
      fingerprint(descriptor.value) !== expected || !Object.isExtensible(prototype)) {
    throw new ReplayResetError('BRIDGE_UNSUPPORTED', '当前 DSH 请求接口版本或原型未经验证，重置按钮已停用；不会修改或发送请求');
  }
  const original = descriptor.value;
  const stopped = Promise.withResolvers();
  let disposed = false;

  function projected(options) {
    if (disposed || !isMarked(options)) return options;
    const result = project(options);
    if (result !== options) mark(result);
    return result;
  }
  function adapterStream(options, prepared) {
    if (disposed) return original.call(this, options, prepared);
    const gate = isMarked(options) ? getGate(options) : undefined;
    if (!gate) return original.call(this, projected(options), prepared);
    const self = this;
    return (async function* () {
      // Disposal releases old waiters as native pass-through too; it must not
      // leave unrelated requests waiting for an uncancellable storage commit.
      await waitGate(Promise.race([gate, stopped.promise]), options.signal);
      yield* original.call(self, projected(options), prepared);
    })();
  }

  // Claim the removable marker first, then change the method. Roll back either
  // write on failure, including a Proxy that applies a write before throwing.
  try {
    Object.defineProperty(prototype, OWNER, {value: adapterStream, configurable: true});
    Object.defineProperty(prototype, 'adapterStream', {...descriptor, value: adapterStream});
  } catch (error) {
    disposed = true;
    stopped.resolve();
    const failures = [error];
    try {
      if (Object.getOwnPropertyDescriptor(prototype, 'adapterStream')?.value === adapterStream) {
        Object.defineProperty(prototype, 'adapterStream', descriptor);
      }
    } catch (rollbackError) { failures.push(rollbackError); }
    try {
      if (Object.getOwnPropertyDescriptor(prototype, OWNER)?.value === adapterStream &&
          !Reflect.deleteProperty(prototype, OWNER)) {
        throw new Error('无法撤销请求桥标记');
      }
    } catch (rollbackError) { failures.push(rollbackError); }
    throw new ReplayResetError('BRIDGE_INSTALL_FAILED',
      failures.length === 1 ? '请求桥安装失败，已撤销本次改动' : '请求桥安装失败且回滚不完整，请完全重启 DSH',
      {cause: failures.length === 1 ? error : new AggregateError(failures)});
  }

  return function dispose() {
    if (disposed) return;
    // In-flight iterators and any later wrapper must stop consulting our state
    // before a restoration attempt that itself might fail on a hardened object.
    disposed = true;
    stopped.resolve();
    if (Object.getOwnPropertyDescriptor(prototype, 'adapterStream')?.value !== adapterStream) {
      warn('其他插件已再次装饰请求接口，未覆盖其方法；完全退出并重启 DSH 后才可确保本桥移除');
      return;
    }
    Object.defineProperty(prototype, 'adapterStream', descriptor);
    if (Object.getOwnPropertyDescriptor(prototype, OWNER)?.value === adapterStream &&
        !Reflect.deleteProperty(prototype, OWNER)) {
      throw new ReplayResetError('BRIDGE_INSTALL_FAILED', '请求接口已恢复但标记未移除，请完全重启 DSH');
    }
  };
}
