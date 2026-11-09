/** Stable, transport-safe error codes shared by the Host and pure policy code. */
export const API_VERSION = 2;

export class ReplayResetError extends Error {
  constructor(code, message, options) {
    super(message, options);
    this.name = 'ReplayResetError';
    this.code = code;
  }
}

export function errorMessage(error) {
  return String(error?.message ?? error);
}

export function errorCode(error, fallback = 'RESET_FAILED') {
  if (typeof error?.code === 'string' && /^[A-Z][A-Z0-9_]{0,63}$/.test(error.code)) {
    return error.code;
  }
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') return 'CANCELLED';
  return fallback;
}
