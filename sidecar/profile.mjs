// 用户在首次引导里选择的偏好，用于调整 Agent 的解释深度，不改变权限或工具。
export const DOMAIN_LABELS = { web: 'Web 安全', android: 'Android 逆向', ios: 'iOS 逆向' };
export const LEVEL_LABELS = { novice: '小白', beginner: '入门', regular: '普通', advanced: '高级', elite: '精英', master: '大佬' };

const LEVEL_HINTS = {
  novice: '从基础概念讲起，给出可以照着做的步骤。',
  beginner: '给出步骤，同时解释关键概念和判断依据。',
  regular: '直接给方案，关键处说明原因。',
  advanced: '少讲基础，聚焦取舍、边界和验证方式。',
  elite: '直接给结论和证据，省略入门解释。',
  master: '按同行讨论，直接给判断、风险和权衡。',
};

export function profilePrompt(settings) {
  const profile = settings?.onboarding;
  const domains = (profile?.domains || []).map(id => DOMAIN_LABELS[id]).filter(Boolean);
  const level = LEVEL_LABELS[profile?.level];
  if (!domains.length || !level) return '';
  return `\n\n用户画像：擅长${domains.join('、')}；逆向水平：${level}。${LEVEL_HINTS[profile.level] || ''}据此调整解释深度和例子选择，不要主动复述画像。`;
}
