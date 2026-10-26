// 工具契约：schema 构造、JSON Schema 输出、运行时校验、注册表体检。
import test from 'node:test';
import assert from 'node:assert/strict';
import { object, str, num, int, bool, arr, validateArgs, toWire, registryIssues } from '../contract.mjs';

const schema = object({
  path: str('文件路径'),
  depth: num({ desc: '深度', min: 0, max: 5 }),
  mode: str({ enum: ['a', 'b'], desc: '模式' }),
  flag: bool('开关'),
  items: arr(str('子项'), '列表'),
  count: int('数量'),
}, ['path']);

test('schema 构造产出标准 JSON Schema（模型可读）', () => {
  const s = object({ a: str('说明'), b: num({ min: 1 }) }, ['a']);
  assert.deepEqual(s, { type: 'object', properties: { a: { type: 'string', description: '说明' }, b: { type: 'number', minimum: 1 } }, required: ['a'] });
  assert.equal(toWire({ name: 'n', description: 'd', schema: s }).schema.required[0], 'a');
});

test('validateArgs: 必填缺失/类型错误/枚举越界都给出可读错误', () => {
  assert.match(validateArgs(schema, {}).error, /缺少必填参数 path/);
  assert.match(validateArgs(schema, { path: 'x', flag: 'yes' }).error, /flag 类型应为 boolean/);
  assert.match(validateArgs(schema, { path: 'x', mode: 'c' }).error, /只能是 a \/ b/);
  assert.match(validateArgs(schema, { path: 'x', depth: 9 }).error, /不能大于 5/);
  assert.match(validateArgs(schema, { path: 'x', count: 1.5 }).error, /类型应为 integer/);
  assert.match(validateArgs(schema, { path: 'x', items: ['a', 2] }).error, /items\[1\] 类型应为 string/);
  assert.equal(validateArgs(schema, { path: 'x' }).ok, true);
});

test('validateArgs: 安全强转（字符串数字 / 布尔）', () => {
  assert.equal(validateArgs(schema, { path: 'x', depth: '3' }).value.depth, 3);
  assert.equal(validateArgs(schema, { path: 'x', flag: 'true' }).value.flag, true);
  assert.equal(validateArgs(schema, { path: 123 }).value.path, '123');
  // 不能被强转的就报错
  assert.match(validateArgs(schema, { path: 'x', depth: 'deep' }).error, /类型应为 number/);
});

test('validateArgs: 未声明字段默认放行，strict 时剔除', () => {
  const v = validateArgs(schema, { path: 'x', confirm: true, extra: 1 });
  assert.equal(v.ok, true);
  assert.equal(v.value.confirm, true);                 // 不改变现有工具的宽松语义
  const s = validateArgs(schema, { path: 'x', confirm: true }, { strict: true });
  assert.deepEqual(s.dropped, ['confirm']);
  assert.equal(s.value.confirm, undefined);
});

test('validateArgs: 不支持的组合关键字放行（避免误杀 MCP / 手写 schema）', () => {
  assert.equal(validateArgs({ type: 'object', properties: { a: { oneOf: [{ type: 'string' }, { type: 'number' }] } } }, { a: [] }).ok, true);
  assert.equal(validateArgs({ type: 'object', properties: { a: { $ref: '#/x' } } }, { a: 1 }).ok, true);
  assert.equal(validateArgs(null, { any: 1 }).ok, true);
  assert.equal(validateArgs({ type: 'object' }, 'not-an-object').ok, true); // 非对象入参视为空
});

test('registryIssues: 重名 / 缺 run / 缺 schema 都能被发现', () => {
  const ok = [{ name: 'a', description: 'd', schema: { type: 'object' }, run: () => ({}) }];
  assert.deepEqual(registryIssues(ok), []);
  const issues = registryIssues([
    ...ok,
    { name: 'a', description: 'dup', schema: { type: 'object' }, run: () => ({}) },
    { name: 'b', description: 'no run', schema: { type: 'object' } },
    { name: 'c', description: 'bad schema', schema: { type: 'string' }, run: () => ({}) },
    { description: 'no name', schema: { type: 'object' }, run: () => ({}) },
  ]);
  assert.equal(issues.length, 4);
  assert.ok(issues.some(i => /重复/.test(i)));
  assert.ok(issues.some(i => /run/.test(i)));
  assert.ok(issues.some(i => /schema/.test(i)));
});

const { DEFAULT_TOOLS } = await import('../catalog.mjs');

test('真实工具注册表：无重名、每个都有 run 与 object schema', () => {
  assert.ok(Array.isArray(DEFAULT_TOOLS) && DEFAULT_TOOLS.length > 20);
  assert.deepEqual(registryIssues(DEFAULT_TOOLS), []);
  for (const t of DEFAULT_TOOLS) {
    assert.equal(typeof t.description, 'string');
    assert.ok(t.description.length > 4, `${t.name} 缺描述`);
  }
});
