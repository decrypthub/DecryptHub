// User-facing support navigation; never registered as an Agent tool.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

export const FEEDBACK_URL = 'https://github.com/decrypthub/DecryptHub/issues/new/choose';
const execute = promisify(execFile);
const environmentKeys = ['PATH', 'HOME', 'USERPROFILE', 'APPDATA', 'LOCALAPPDATA', 'SystemRoot', 'SYSTEMROOT', 'WINDIR', 'TMP', 'TEMP', 'DISPLAY', 'WAYLAND_DISPLAY', 'XAUTHORITY', 'DBUS_SESSION_BUS_ADDRESS', 'XDG_RUNTIME_DIR', 'XDG_CURRENT_DESKTOP', 'DESKTOP_SESSION'];

export async function openFeedback({ nativeHost = false, platform = process.platform, launch = execute } = {}) {
  if (!nativeHost) throw Error('请在桌面应用中打开反馈页面');
  const command = { darwin: 'open', win32: 'explorer.exe', linux: 'xdg-open' }[platform];
  if (!command) throw Error('当前系统不支持打开反馈页面');
  try {
    await launch(command, [FEEDBACK_URL], { timeout: 5000, maxBuffer: 65536, windowsHide: true, env: Object.fromEntries(environmentKeys.filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]])) });
  } catch { throw Error('无法打开系统浏览器'); }
  return { opened: true };
}
