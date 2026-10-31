// Tauri rejects native Result errors as strings; network/JS errors use Error.
export function accountErrorMessage(error) {
  if (typeof error === 'string' && error.trim()) return error;
  if (error && typeof error.message === 'string' && error.message.trim()) return error.message;
  return '账号操作未完成，请重试';
}
