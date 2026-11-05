/** Product-owned account copy; reputation is separate from model usage. */
export const en = {
  nav: 'Account', title: 'DecryptHub account', description: 'Sign in with your community account. Model API channels are configured separately.',
  signedOut: 'Not signed in', signIn: 'Sign in with browser', waiting: 'Waiting for browser authorization', exchanging: 'Completing sign-in',
  cancel: 'Cancel sign-in', reopen: 'Reopen browser', refresh: 'Refresh account', signOut: 'Sign out',
  points: 'Points', experience: 'Experience', community: 'Open community', pointsCenter: 'Points center',
  settings: 'Settings', menu: 'Account and settings', loading: 'Loading account', transport: 'Cannot connect to the native account service. Please retry.',
  'error.network': 'Cannot connect to the community. Check your network and retry.',
  'error.unavailable': 'The community desktop sign-in endpoint is unavailable.',
  'error.protocol': 'The community response is invalid. Please sign in again.',
  'error.storage': 'Cannot access the encrypted account store. Check system keychain access and retry.',
  'error.expired': 'Your session has expired. Please sign in again.',
  'error.denied': 'Browser authorization was cancelled.',
  'error.browser': 'Cannot open the system browser. Check the default browser and retry.',
  'error.timeout': 'Sign-in timed out. Please try again.',
} as const
/** Dictionary keys accepted by account components. */
export type CommunityAccountKey = keyof typeof en
/** Chinese account dictionary. */
export const zh: Record<CommunityAccountKey, string> = {
  nav: '账号', title: 'DecryptHub 账号', description: '使用社区账号登录。模型 API 渠道单独配置。',
  signedOut: '未登录', signIn: '通过浏览器登录', waiting: '等待浏览器授权', exchanging: '正在完成登录',
  cancel: '取消登录', reopen: '重新打开浏览器', refresh: '刷新账号', signOut: '退出登录',
  points: '积分', experience: '经验', community: '打开社区', pointsCenter: '积分中心',
  settings: '设置', menu: '账号与设置', loading: '正在读取账号', transport: '无法连接原生账号服务，请重试。',
  'error.network': '无法连接社区，请检查网络后重试。',
  'error.unavailable': '社区桌面登录接口暂不可用。',
  'error.protocol': '社区返回的信息无效，请重新登录。',
  'error.storage': '无法访问加密账号存储，请检查系统钥匙串授权后重试。',
  'error.expired': '登录已失效，请重新登录。',
  'error.denied': '已取消浏览器授权。',
  'error.browser': '无法打开系统浏览器，请检查默认浏览器设置后重试。',
  'error.timeout': '登录已超时，请重新登录。',
}
