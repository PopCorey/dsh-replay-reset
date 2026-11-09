/* Native DSH client entry: host React only; no build step or DOM discovery.
 * DSH 0.2.2-rc.1: conversation.input.right is a session-scoped list. Borrow the
 * current Session binding and public mainView retain source without retaining
 * or opening a Session. Keep the loader id equal to the package manifest name.
 */
window.__ModuleLoader__.load({
  id: "dsh-replay-reset",
  factory(require) {
    "use strict";
    const React = require("react");
    const SLOT = "conversation.input.right";
    const ENDPOINT = "/plugins/replay-reset";
    const LOCALE_NS = "dsh-replay-reset";
    const API_VERSION = 2;
    const UUID = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
    const CODE = /^[A-Z][A-Z0-9_]{0,79}$/;
    const DICTIONARIES = Object.freeze({
      en: Object.freeze({
        "button.reset": "Reset old replay",
        "button.checking": "Checking…",
        "button.resetting": "Resetting…",
        "button.retry": "Retry checking",
        "button.close": "Close",
        "aria.close": "Dismiss replay reset notice",
        "tooltip": "{reason} Marked old replay states in this session: {count}.",
        "state.checking": "Checking replay reset status…",
        "state.resetting": "Checking and marking old replay state…",
        "state.waiting": "Waiting for the reset result…",
        "state.waitingLast": "Waiting for the previous reset to finish…",
        "notice.done": "Marked {addedCount} old replay states across {sessionCount} sessions. This session has {resetCount} marked states. History is unchanged; no message was sent.",
        "notice.noop": "No additional old replay state needs resetting. This session still has {resetCount} marked states. History is unchanged; no message was sent.",
        "notice.unsent": "{detail} No reset request was sent.",
        "notice.unconfirmed": "{detail} The result is unconfirmed; check status first and do not repeat the reset.",
        "code.READY": "Manually reset old Responses replay state without sending a message or rerunning tools.",
        "code.BUSY": "Wait for the current run to finish before resetting.",
        "code.AUTH_UNAVAILABLE": "DSH authentication is not ready. Retry checking later.",
        "code.AUTH_REQUIRED": "Return to DSH and sign in before retrying.",
        "code.AUTH_REJECTED": "DSH rejected authentication or security checks. Refresh the page and retry checking.",
        "code.INVALID_SESSION_ID": "The session identifier is invalid.",
        "code.INVALID_OPERATION_ID": "The operation identifier is invalid.",
        "code.INVALID_BODY": "DSH rejected the request body.",
        "code.REQUEST_TOO_LARGE": "The reset request is too large.",
        "code.JSON_REQUIRED": "DSH requires a JSON reset request.",
        "code.NOT_FOUND": "The replay reset endpoint is unavailable.",
        "code.ORIGIN_REJECTED": "Only the current DSH page may request a reset.",
        "code.CSRF_EXPIRED": "The page security token expired. Retry checking to obtain a fresh token.",
        "code.LOADING": "DSH is loading the replay reset policy. Retry checking shortly.",
        "code.PLUGIN_STOPPED": "The replay reset plugin is stopped. Retry checking after it is available.",
        "code.POLICY_LOAD_FAILED": "The replay reset policy could not be loaded. Check the plugin before retrying.",
        "code.HOST_MODULE_MISMATCH": "The replay reset module does not match this DSH Host.",
        "code.BRIDGE_DUPLICATE": "A replay reset bridge is already installed. Check the plugin configuration.",
        "code.BRIDGE_UNSUPPORTED": "This DSH request interface has not been verified for safe replay reset.",
        "code.BRIDGE_INSTALL_FAILED": "DSH could not install the replay reset bridge safely.",
        "code.RESET_FAILED": "DSH could not complete the reset.",
        "code.INVALID_REPLAY_STATE": "Historical replay metadata is inconsistent; no reset was committed.",
        "code.UNBALANCED_HISTORY": "Finish or recover the open run and tool calls in DSH before resetting.",
        "code.DUPLICATE_TOOL_CALL": "History contains duplicate tool call identifiers; no reset was committed.",
        "code.ORPHAN_TOOL_RESULT": "A historical tool result has no matching call; no reset was committed.",
        "code.MISSING_TOOL_RESULT": "A historical tool call has no result; no reset was committed.",
        "code.OPERATION_CONFLICT": "The operation identifier conflicts with another reset.",
        "code.IDENTITY_CHANGED": "The session identity changed. Check the session before retrying.",
        "code.INVALID_POLICY": "The replay reset policy is invalid; no reset was committed.",
        "code.SUBAGENT_UNAVAILABLE": "An associated subagent cannot be checked safely; no sessions were reset.",
        "code.SUBAGENT_LIMIT": "The associated subagent tree exceeds this plugin's safe limit.",
        "code.SESSION_BUSY": "The session is running or awaiting interaction. Finish that work before resetting.",
        "code.UNSUPPORTED_PROVIDER": "This version supports only AgentRouter Responses sessions.",
        "code.TOPOLOGY_CHANGED": "The subagent tree changed during the check. Retry checking first.",
        "code.SESSION_CHANGED": "The session changed during the check. Retry checking first.",
        "code.SESSION_READ_FAILED": "DSH could not read the session safely.",
        "code.STORAGE_WRITE_FAILED": "DSH could not confirm durable replay reset storage. Check status before retrying.",
        "code.CANCELLED": "The reset was cancelled.",
        "code.CLIENT_API_MISMATCH": "The plugin UI and Host use incompatible API versions. Update or refresh them together, then retry checking.",
        "code.CLIENT_INVALID_STATUS": "The status response is invalid or belongs to another session.",
        "code.CLIENT_INVALID_CSRF": "The status response has no valid page security token.",
        "code.CLIENT_INVALID_RESULT": "The reset response is invalid or does not match this operation.",
        "code.CLIENT_OPERATION_UNAVAILABLE": "A valid operation identifier could not be created.",
        "code.CLIENT_SESSION_UNAVAILABLE": "The session interface is unavailable.",
        "code.CLIENT_NOT_MAIN": "The session was switched or is no longer retained by the main view.",
        "code.CLIENT_SESSION_NOT_READY": "The session is unavailable or has been removed.",
        "code.CLIENT_TIMEOUT": "The request timed out.",
        "code.CLIENT_STATUS_TIMEOUT": "The status check timed out. You may retry checking.",
        "code.CLIENT_INVALID_JSON": "DSH returned invalid JSON (HTTP {status}).",
        "code.CLIENT_HTTP_ERROR": "DSH rejected the request (HTTP {status}; code {code}).",
        "code.CLIENT_NETWORK_ERROR": "The request could not reach DSH ({detail}).",
        "code.CLIENT_UNKNOWN": "Replay reset is unavailable ({code}).",
      }),
      zh: Object.freeze({
        "button.reset": "重置旧回放",
        "button.checking": "检查中…",
        "button.resetting": "重置中…",
        "button.retry": "重试检查",
        "button.close": "关闭",
        "aria.close": "关闭重置提示",
        "tooltip": "{reason} 当前会话已标记 {count} 条旧回放状态。",
        "state.checking": "正在检查重置状态…",
        "state.resetting": "正在检查并标记旧回放状态…",
        "state.waiting": "正在等待重置结果…",
        "state.waitingLast": "等待上次重置完成…",
        "notice.done": "已新增标记 {addedCount} 条旧回放状态（{sessionCount} 个会话）；当前会话累计 {resetCount} 条。历史未改，未发送消息。",
        "notice.noop": "没有新增旧回放需要重置；当前会话仍累计标记 {resetCount} 条。历史未改，未发送消息。",
        "notice.unsent": "{detail} 未发送重置请求。",
        "notice.unconfirmed": "{detail} 结果未确认；请先检查状态，勿连续重试。",
        "code.READY": "手动重置旧 Responses 回放；不会发送消息或重跑工具。",
        "code.BUSY": "请先等待当前运行结束，再重置。",
        "code.AUTH_UNAVAILABLE": "DSH 鉴权尚未就绪，请稍后重试检查。",
        "code.AUTH_REQUIRED": "请返回 DSH 登录后重试检查。",
        "code.AUTH_REJECTED": "DSH 拒绝了认证或安全校验，请刷新页面后重试检查。",
        "code.INVALID_SESSION_ID": "会话标识无效。",
        "code.INVALID_OPERATION_ID": "操作标识无效。",
        "code.INVALID_BODY": "DSH 拒绝了请求内容。",
        "code.REQUEST_TOO_LARGE": "重置请求过大。",
        "code.JSON_REQUIRED": "DSH 要求使用 JSON 重置请求。",
        "code.NOT_FOUND": "旧回放重置接口不可用。",
        "code.ORIGIN_REJECTED": "只允许当前 DSH 界面请求重置。",
        "code.CSRF_EXPIRED": "界面安全凭证已过期，请重试检查获取新凭证。",
        "code.LOADING": "DSH 正在加载重置策略，请稍后重试检查。",
        "code.PLUGIN_STOPPED": "旧回放重置插件已停止，请在插件可用后重试检查。",
        "code.POLICY_LOAD_FAILED": "重置策略读取失败，请检查插件后再重试。",
        "code.HOST_MODULE_MISMATCH": "旧回放重置模块与当前 DSH 宿主不一致。",
        "code.BRIDGE_DUPLICATE": "已有旧回放重置桥，请检查插件配置。",
        "code.BRIDGE_UNSUPPORTED": "当前 DSH 请求接口尚未经安全重置验证。",
        "code.BRIDGE_INSTALL_FAILED": "DSH 未能安全安装旧回放重置桥。",
        "code.RESET_FAILED": "DSH 未能完成重置。",
        "code.INVALID_REPLAY_STATE": "历史回放元数据不一致，未提交重置。",
        "code.UNBALANCED_HISTORY": "请先在 DSH 中正常结束或恢复未闭合的运行及工具调用，再重置。",
        "code.DUPLICATE_TOOL_CALL": "历史工具调用标识重复，未提交重置。",
        "code.ORPHAN_TOOL_RESULT": "历史工具结果缺少对应调用，未提交重置。",
        "code.MISSING_TOOL_RESULT": "历史工具调用缺少结果，未提交重置。",
        "code.OPERATION_CONFLICT": "操作标识与其他重置冲突。",
        "code.IDENTITY_CHANGED": "会话身份已变化，请检查会话后再重试。",
        "code.INVALID_POLICY": "重置策略无效，未提交重置。",
        "code.SUBAGENT_UNAVAILABLE": "有关联子代理无法安全核验，未重置任何会话。",
        "code.SUBAGENT_LIMIT": "关联子代理树超过本插件安全上限。",
        "code.SESSION_BUSY": "会话正在运行或等待交互，请先完成该工作再重置。",
        "code.UNSUPPORTED_PROVIDER": "本版本仅支持 AgentRouter 的 Responses 会话。",
        "code.TOPOLOGY_CHANGED": "子代理树在核验期间变化，请先重试检查。",
        "code.SESSION_CHANGED": "会话在核验期间变化，请先重试检查。",
        "code.SESSION_READ_FAILED": "DSH 无法安全读取会话。",
        "code.STORAGE_WRITE_FAILED": "DSH 无法确认重置策略已持久保存，请先检查状态再重试。",
        "code.CANCELLED": "重置已取消。",
        "code.CLIENT_API_MISMATCH": "插件界面与宿主的 API 版本不兼容，请一起更新或刷新后重试检查。",
        "code.CLIENT_INVALID_STATUS": "状态响应无效或属于其他会话。",
        "code.CLIENT_INVALID_CSRF": "状态响应缺少有效的界面安全凭证。",
        "code.CLIENT_INVALID_RESULT": "重置响应无效或不匹配本次操作。",
        "code.CLIENT_OPERATION_UNAVAILABLE": "无法生成有效的操作标识。",
        "code.CLIENT_SESSION_UNAVAILABLE": "会话接口不可用。",
        "code.CLIENT_NOT_MAIN": "当前会话已切换或不再由主视图保留。",
        "code.CLIENT_SESSION_NOT_READY": "会话不可用或已移除。",
        "code.CLIENT_TIMEOUT": "请求超时。",
        "code.CLIENT_STATUS_TIMEOUT": "状态检查超时，可重试检查。",
        "code.CLIENT_INVALID_JSON": "DSH 响应不是有效 JSON（HTTP {status}）。",
        "code.CLIENT_HTTP_ERROR": "DSH 拒绝了请求（HTTP {status}；错误码 {code}）。",
        "code.CLIENT_NETWORK_ERROR": "请求无法到达 DSH（{detail}）。",
        "code.CLIENT_UNKNOWN": "旧回放重置不可用（{code}）。",
      }),
    });
    const CSS = `
.dsh-replay-reset{position:relative;display:inline-flex;align-items:center;gap:4px;flex:none}
.dsh-replay-reset__button{display:inline-flex;align-items:center;justify-content:center;gap:5px;min-height:28px;padding:3px 7px;border:0;border-radius:6px;background:transparent;color:var(--dsw-alias-label-secondary);font:inherit;font-size:13px;line-height:20px;white-space:nowrap;cursor:pointer}
.dsh-replay-reset__button:disabled{opacity:.5;cursor:not-allowed}
.dsh-replay-reset__button:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
.dsh-replay-reset__button:not(:disabled):hover{background:var(--dsw-alias-bg-layer-2)}
.dsh-replay-reset__notice{position:absolute;z-index:1100;right:0;bottom:calc(100% + 8px);box-sizing:border-box;width:max-content;max-width:min(320px,80vw);padding:8px 10px;border:1px solid var(--dsw-alias-border-l2);border-radius:8px;background:var(--dsw-alias-bg-overlay);color:var(--dsw-alias-label-primary);font-size:12px;line-height:1.6;white-space:normal;overflow-wrap:anywhere}
.dsh-replay-reset__notice[data-kind=error]{border-color:var(--dsw-alias-state-error-primary)}
.dsh-replay-reset__notice[data-kind=success]{border-color:var(--dsw-alias-state-success-primary)}
.dsh-replay-reset__dismiss{margin-inline-start:8px;border:0;background:transparent;color:inherit;cursor:pointer;font:inherit;text-decoration:underline}
.dsh-replay-reset__dismiss:focus-visible{outline:2px solid var(--dsw-alias-brand-primary);outline-offset:2px}
@media(max-width:560px){.dsh-replay-reset__label{display:none}.dsh-replay-reset__button{min-width:28px;padding-inline:5px}}
`;

    const record = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
    const count = (value) => Number.isSafeInteger(value) && value >= 0;
    const safeCode = (value) => typeof value === "string" && CODE.test(value) ? value : "UNKNOWN";
    const spec = (key, params = {}) => ({ key, params });
    function codeSpec(code) {
      const clean = safeCode(code);
      const key = `code.${clean}`;
      return Object.hasOwn(DICTIONARIES.en, key) ? spec(key) : spec("code.CLIENT_UNKNOWN", { code: clean });
    }
    function translate(t, value) {
      if (!value) return "";
      const params = Object.fromEntries(Object.entries(value.params).map(([key, item]) =>
        [key, record(item) && typeof item.key === "string" ? translate(t, item) : item]));
      return t(value.key, params);
    }
    class ClientFailure extends Error {
      constructor(code, params = {}) {
        super(code);
        this.name = "ReplayResetClientError";
        this.code = code;
        this.display = Object.keys(params).length ? spec(`code.${code}`, params) : codeSpec(code);
      }
    }
    function hostFailure(body, status = 200) {
      const code = record(body) ? safeCode(body.code ?? body.reasonCode ?? body.error?.code) : "UNKNOWN";
      if (code !== "READY" && code !== "BUSY" && !code.startsWith("CLIENT_") &&
          Object.hasOwn(DICTIONARIES.en, `code.${code}`)) return new ClientFailure(code);
      if (code === "UNKNOWN" && status === 401) return new ClientFailure("AUTH_REQUIRED");
      if (code === "UNKNOWN" && status === 403) return new ClientFailure("AUTH_REJECTED");
      return new ClientFailure("CLIENT_HTTP_ERROR", { status, code });
    }
    function failureSpec(error, statusCheck = false) {
      if (error instanceof ClientFailure) {
        return statusCheck && error.code === "CLIENT_TIMEOUT" ? codeSpec("CLIENT_STATUS_TIMEOUT") : error.display;
      }
      if (error?.name === "AbortError") return codeSpec(statusCheck ? "CLIENT_STATUS_TIMEOUT" : "CLIENT_TIMEOUT");
      // Never publish arbitrary server/error strings, URLs, credentials or CSRF.
      const detail = typeof error?.name === "string" && /^[A-Za-z][A-Za-z0-9_]{0,63}$/.test(error.name) ? error.name : "Error";
      return spec("code.CLIENT_NETWORK_ERROR", { detail });
    }
    function validateStatus(value, sessionId) {
      if (!record(value)) throw new ClientFailure("CLIENT_INVALID_STATUS");
      if (value.apiVersion !== API_VERSION) throw new ClientFailure("CLIENT_API_MISMATCH");
      if (value.sessionId !== sessionId || typeof value.supported !== "boolean" ||
          typeof value.ready !== "boolean" || typeof value.busy !== "boolean" ||
          !count(value.resetCount) || typeof value.reasonCode !== "string" || !CODE.test(value.reasonCode) ||
          (value.ready && (!value.supported || value.busy || value.reasonCode !== "READY")) ||
          (value.reasonCode === "READY" && !value.ready) || (value.reasonCode === "BUSY" && !value.busy) ||
          (value.reasonCode === "UNSUPPORTED_PROVIDER" && value.supported)) {
        throw new ClientFailure("CLIENT_INVALID_STATUS");
      }
      if (value.ready && (typeof value.csrf !== "string" || !/^[a-f0-9]{64}$/.test(value.csrf))) {
        throw new ClientFailure("CLIENT_INVALID_CSRF");
      }
      return { supported: value.supported, ready: value.ready, busy: value.busy,
        csrf: value.csrf, resetCount: value.resetCount, reasonCode: value.reasonCode,
        reasonSpec: codeSpec(value.reasonCode) };
    }
    function validateResult(value, sessionId, operationId, previousCount = 0) {
      if (!record(value)) throw new ClientFailure("CLIENT_INVALID_RESULT");
      if (value.apiVersion !== API_VERSION) throw new ClientFailure("CLIENT_API_MISMATCH");
      if (value.sessionId !== sessionId || value.operationId !== operationId || typeof value.ok !== "boolean") {
        throw new ClientFailure("CLIENT_INVALID_RESULT");
      }
      if (!value.ok) throw hostFailure(value);
      if (typeof value.changed !== "boolean" || !count(value.addedCount) || !count(value.resetCount) ||
          value.changed !== (value.addedCount > 0) || value.resetCount < previousCount ||
          !Array.isArray(value.sessions) || !value.sessions.length ||
          !value.sessions.every((id) => typeof id === "string" && id.length > 0 && id.length <= 256) ||
          new Set(value.sessions).size !== value.sessions.length || !value.sessions.includes(sessionId)) {
        throw new ClientFailure("CLIENT_INVALID_RESULT");
      }
      // Root cumulative count need not equal/exceed a whole-tree addition count.
      return { changed: value.changed, addedCount: value.addedCount,
        resetCount: value.resetCount, sessionCount: value.sessions.length };
    }

    /** Read-only until an explicit click; locale revisions never perform I/O. */
    function createResetController({ sessionId, getGuard, subscribeGuard, fetch: request,
      operationId, locale, t, locks = new Map(), timeoutMs = 45000 }) {
      const listeners = new Set();
      let state = { phase: "idle", supported: false, ready: false, busy: false, canCheck: false,
        reasonSpec: spec("state.checking"), reasonCode: "CLIENT_CHECKING", resetCount: 0,
        addedCount: 0, messageSpec: null, kind: "info" };
      const rendered = () => {
        const { reasonSpec, messageSpec, ...values } = state;
        return { ...values, reason: translate(t, reasonSpec), message: translate(t, messageSpec) };
      };
      let snapshot = rendered();
      let active = false, mounts = 0, disposed = false, epoch = 0;
      let signature, unsubscribeGuard, unsubscribeLocale, reading, posting;
      const requests = new Set();
      const publish = (patch) => {
        if (disposed) return;
        state = { ...state, ...patch };
        snapshot = rendered();
        for (const listener of listeners) listener();
      };
      const guard = () => {
        try {
          const value = getGuard();
          if (!record(value) || typeof value.active !== "boolean" || typeof value.busy !== "boolean") throw new Error();
          return { active: value.active, busy: value.busy,
            reasonCode: value.reasonCode ?? (value.busy ? "SESSION_BUSY" : value.active ? "READY" : "CLIENT_NOT_MAIN") };
        } catch { return { active: false, busy: false, reasonCode: "CLIENT_SESSION_UNAVAILABLE" }; }
      };
      const current = (version) => active && !disposed && version === epoch && guard().active;
      const abortRead = () => { reading?.abort(); reading = undefined; };
      function disconnectSources() {
        unsubscribeGuard?.(); unsubscribeGuard = undefined;
        unsubscribeLocale?.(); unsubscribeLocale = undefined;
      }
      async function json(url, init, isPost = false) {
        const controller = new AbortController();
        requests.add(controller);
        if (!isPost) reading = controller;
        const timer = setTimeout(() => controller.abort(), timeoutMs);
        try {
          const response = await request(url, {
            credentials: "same-origin", mode: "same-origin", cache: "no-store", redirect: "error",
            ...init, signal: controller.signal,
          });
          let body;
          try { body = await response.json(); }
          catch { throw new ClientFailure("CLIENT_INVALID_JSON", { status: response.status }); }
          if (!response.ok) throw hostFailure(body, response.status);
          return body;
        } catch (error) {
          if (controller.signal.aborted) throw new ClientFailure("CLIENT_TIMEOUT");
          throw error;
        } finally {
          clearTimeout(timer);
          requests.delete(controller);
          if (reading === controller) reading = undefined;
        }
      }
      async function readStatus() {
        return validateStatus(await json(`${ENDPOINT}/status?sessionId=${encodeURIComponent(sessionId)}`,
          { method: "GET", headers: { Accept: "application/json" } }), sessionId);
      }
      function safeStatus(status) {
        // A token belongs only to this request; neither state nor React receives it.
        const { csrf, ...safe } = status;
        return safe;
      }
      async function refresh() {
        const before = guard();
        if (!active || disposed || !before.active || before.busy || posting || locks.has(sessionId)) return;
        abortRead();
        const version = ++epoch;
        publish({ phase: "loading", ready: false, messageSpec: null,
          reasonCode: "CLIENT_CHECKING", reasonSpec: spec("state.checking") });
        try {
          const status = await readStatus();
          if (!current(version)) return;
          publish({ ...safeStatus(status), phase: "idle" });
        } catch (error) {
          if (!current(version)) return;
          const display = failureSpec(error, true);
          publish({ phase: "error", ready: false, reasonCode: display.key.slice(5), reasonSpec: display,
            messageSpec: display, kind: "error" });
        }
      }
      function sync() {
        if (!active || disposed) return;
        const next = guard();
        const key = JSON.stringify([next.active, next.busy, next.reasonCode]);
        if (key === signature) return;
        signature = key;
        ++epoch;
        abortRead();
        publish({ canCheck: next.active && !next.busy });
        if (!next.active || next.busy) {
          publish({ phase: "idle", ready: false, busy: next.busy,
            reasonCode: next.reasonCode, reasonSpec: codeSpec(next.reasonCode), messageSpec: null });
        } else if (!posting && !locks.has(sessionId)) {
          void refresh();
        } else if (posting) {
          publish({ phase: "resetting", ready: false, reasonSpec: spec("state.waiting") });
        } else {
          publish({ phase: "resetting", ready: false, reasonSpec: spec("state.waitingLast") });
          const waitingEpoch = epoch;
          void locks.get(sessionId).settled.then(() => {
            if (!current(waitingEpoch)) return;
            signature = undefined;
            sync();
          });
        }
      }
      async function reset() {
        const before = guard();
        if (!active || disposed || posting || locks.has(sessionId) || !before.active || before.busy ||
            snapshot.phase !== "idle" || !snapshot.supported || !snapshot.ready || snapshot.busy) return false;
        let finish;
        const lock = { settled: new Promise((resolve) => { finish = resolve; }) };
        locks.set(sessionId, lock); posting = lock;
        abortRead();
        const version = ++epoch;
        let sent = false;
        publish({ phase: "resetting", messageSpec: null, reasonSpec: spec("state.resetting") });
        try {
          const status = await readStatus();
          if (!current(version) || guard().busy) return false;
          if (!status.supported || !status.ready || status.busy) {
            publish({ ...safeStatus(status), phase: "idle", messageSpec: status.reasonSpec, kind: "info" });
            return false;
          }
          let id;
          try { id = operationId(); } catch { throw new ClientFailure("CLIENT_OPERATION_UNAVAILABLE"); }
          if (typeof id !== "string" || !UUID.test(id)) throw new ClientFailure("CLIENT_OPERATION_UNAVAILABLE");
          // Re-read binding identity and mainView retention after every async boundary.
          if (!current(version) || guard().busy) return false;
          sent = true;
          const body = await json(`${ENDPOINT}/reset`, {
            method: "POST", headers: { Accept: "application/json", "Content-Type": "application/json",
              "x-replay-reset-csrf": status.csrf }, body: JSON.stringify({ sessionId, operationId: id }),
          }, true);
          const result = validateResult(body, sessionId, id, status.resetCount);
          if (!current(version)) return false;
          publish({ ...safeStatus(status), phase: "idle", resetCount: result.resetCount,
            addedCount: result.addedCount, messageSpec: spec(result.changed ? "notice.done" : "notice.noop", result),
            kind: "success" });
          return true;
        } catch (error) {
          if (!current(version)) return false;
          const display = failureSpec(error);
          publish({ phase: "error", ready: false, reasonCode: display.key.slice(5), reasonSpec: display, kind: "error",
            messageSpec: spec(sent ? "notice.unconfirmed" : "notice.unsent", { detail: display }) });
          return false;
        } finally {
          posting = undefined;
          if (locks.get(sessionId) === lock) locks.delete(sessionId);
          finish();
          // Navigation may suppress a result, but must never replay its POST.
          if (active && !disposed && (version !== epoch || !guard().active || guard().busy)) {
            signature = undefined;
            sync();
          }
        }
      }
      return {
        getSnapshot: () => snapshot,
        subscribe(listener) { listeners.add(listener); return () => listeners.delete(listener); },
        connect() {
          if (disposed) return () => {};
          if (++mounts === 1) {
            active = true;
            signature = undefined;
            try {
              unsubscribeGuard = subscribeGuard(sync);
              // Only presentation changes here: no epoch invalidation, sync or I/O.
              unsubscribeLocale = locale.subscribe(() => publish({}));
              publish({});
              sync();
            } catch (error) {
              active = false;
              disconnectSources();
              publish({ phase: "error", ready: false, canCheck: false, reasonCode: "CLIENT_SESSION_UNAVAILABLE",
                reasonSpec: codeSpec("CLIENT_SESSION_UNAVAILABLE"),
                messageSpec: codeSpec("CLIENT_SESSION_UNAVAILABLE"), kind: "error" });
            }
          }
          let connected = true;
          return () => {
            if (!connected) return;
            connected = false;
            if (--mounts !== 0) return;
            active = false; ++epoch;
            disconnectSources(); abortRead();
          };
        },
        refresh, reset,
        dismiss() { publish({ messageSpec: null }); },
        dispose() {
          if (disposed) return;
          disposed = true; active = false; ++epoch;
          disconnectSources();
          for (const request of requests) request.abort();
          listeners.clear();
        },
      };
    }

    function nativeGuard(ctx, sessionId, binding, retention) {
      try {
        if (!binding || ctx.sessions.binding(sessionId) !== binding) {
          return { active: false, busy: false, reasonCode: "CLIENT_NOT_MAIN" };
        }
        const retainedBy = (retention ?? ctx.sessions.retainInfo(sessionId)).getSnapshot()?.retainedBy;
        if (!record(retainedBy) || !Object.hasOwn(retainedBy, "mainView") ||
            !count(retainedBy.mainView) || retainedBy.mainView === 0) {
          return { active: false, busy: false, reasonCode: "CLIENT_NOT_MAIN" };
        }
        const state = binding.session.getSnapshot();
        if (!state || state.removed || typeof state.running !== "boolean") {
          return { active: false, busy: false, reasonCode: "CLIENT_SESSION_NOT_READY" };
        }
        const busy = state.running || ctx.uiSession.sessionStatus.getSnapshot().get(sessionId)?.pendingInteraction !== undefined;
        return { active: true, busy, reasonCode: busy ? "SESSION_BUSY" : "READY" };
      } catch { return { active: false, busy: false, reasonCode: "CLIENT_SESSION_UNAVAILABLE" }; }
    }
    function ResetButton({ controller, t }) {
      const status = React.useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
      React.useEffect(() => controller.connect(), [controller]);
      const checking = status.phase === "loading", resetting = status.phase === "resetting";
      const retry = status.phase === "error" || (!checking && !resetting && (!status.supported || !status.ready || status.busy));
      const disabled = checking || resetting || !status.canCheck;
      const key = resetting ? "button.resetting" : checking ? "button.checking" :
        status.busy ? "button.reset" : retry ? "button.retry" : "button.reset";
      const label = t(key);
      const title = t("tooltip", { reason: status.reason, count: status.resetCount });
      return React.createElement("span", { className: "dsh-replay-reset", title },
        React.createElement("style", { "data-plugin-css": "dsh-replay-reset/client" }, CSS),
        React.createElement("button", {
          type: "button", className: "dsh-replay-reset__button", disabled,
          "aria-label": label, "aria-busy": checking || resetting,
          "data-testid": "replay-reset-button", title,
          onClick(event) {
            event.preventDefault(); event.stopPropagation();
            if (retry) void controller.refresh(); else void controller.reset();
          },
        }, React.createElement("svg", { width: 14, height: 14, viewBox: "0 0 16 16", fill: "none", "aria-hidden": true },
          React.createElement("path", { d: "M3.1 5.1A5.3 5.3 0 1 1 2.7 10M3.1 1.9v3.5h3.5",
            stroke: "currentColor", strokeWidth: 1.5, strokeLinecap: "round", strokeLinejoin: "round" })),
          React.createElement("span", { className: "dsh-replay-reset__label" }, label)),
        status.message ? React.createElement("span", {
          className: "dsh-replay-reset__notice", role: status.kind === "error" ? "alert" : "status",
          "aria-live": status.kind === "error" ? "assertive" : "polite", "data-kind": status.kind,
        }, status.message, React.createElement("button", {
          type: "button", className: "dsh-replay-reset__dismiss", "aria-label": t("aria.close"),
          onClick(event) { event.preventDefault(); event.stopPropagation(); controller.dismiss(); },
        }, t("button.close"))) : null);
    }

    const inject = ["slots", "sessions", "uiSession", "locale"];
    function apply(ctx) {
      const controllers = new Map(), bindingReleases = new Set(), locks = new Map();
      let live = true;
      ctx.effect(() => () => {
        live = false;
        for (const controller of controllers.values()) controller.dispose();
        for (const release of [...bindingReleases]) release();
        bindingReleases.clear(); controllers.clear();
      });
      ctx.effect(() => ctx.locale.register(LOCALE_NS, DICTIONARIES));
      const t = ctx.locale.bind(LOCALE_NS);
      function controllerFor(sessionId) {
        const binding = ctx.sessions.binding(sessionId);
        if (!live || !binding) throw new Error(t("code.CLIENT_SESSION_UNAVAILABLE"));
        if (controllers.has(binding)) return controllers.get(binding);
        const retention = ctx.sessions.retainInfo(sessionId);
        const controller = createResetController({ sessionId, locks, t, locale: ctx.locale,
          getGuard: () => nativeGuard(ctx, sessionId, binding, retention),
          subscribeGuard(listener) {
            const disposers = [];
            try {
              for (const source of [binding.session, retention, ctx.uiSession.sessionStatus]) {
                disposers.push(source.subscribe(listener));
              }
            } catch (error) { for (const dispose of disposers.reverse()) dispose(); throw error; }
            return () => { for (const dispose of disposers.reverse()) dispose(); };
          },
          fetch: (...args) => globalThis.fetch(...args), operationId: () => globalThis.crypto.randomUUID(),
        });
        controllers.set(binding, controller);
        let release;
        try {
          release = binding.ctx.effect(() => () => {
            controller.dispose(); controllers.delete(binding); bindingReleases.delete(release);
          });
          bindingReleases.add(release);
        } catch (error) { controller.dispose(); controllers.delete(binding); throw error; }
        return controller;
      }
      ctx.slots.inject(SLOT, () => ctx.slots.register({
        name: SLOT, id: "replay-reset", order: 1000, locale: LOCALE_NS,
        inject: (sessionId) => ({ controller: controllerFor(sessionId) }),
      }, ResetButton));
    }
    return { inject, apply, createResetController, nativeGuard, validateStatus, validateResult,
      ResetButton, DICTIONARIES, LOCALE_NS };
  },
});
