export class SessionQueryError extends Error {
  constructor(message, code = 'SESSION_QUERY_UNAVAILABLE', options) { super(message, options); this.name = 'SessionQueryError'; this.code = code; }
}
export class SessionReferenceError extends Error {
  constructor(message, code, options) { super(message, options); this.name = 'SessionReferenceError'; this.code = code; }
}
export function brandString(value) { if (typeof value !== 'string') throw TypeError('会话标识必须是字符串'); return value; }
