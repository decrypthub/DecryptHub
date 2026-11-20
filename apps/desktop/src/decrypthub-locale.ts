/** Product naming applied after selecting an unchanged upstream dictionary. */

/**
 * Substitute the product title without copying upstream translations.
 * @param messages - Selected upstream dictionary.
 * @returns The same message keys with product-facing Harness names substituted.
 */
export function productMessages<T extends Readonly<Record<string, string>>>(messages: T): T {
  const title = process.env.DSH_CLIENT_TITLE
  if (title === undefined || title === 'DeepSeek Harness') return messages
  return Object.fromEntries(Object.entries(messages).map(([key, value]) => [key,
    value.replaceAll(key === 'welcomeKeyDescription'
      ? /DeepSeek Harness|\b(?:DSH|Harness)\b/gu
      : /DeepSeek Harness|\bDSH\b/gu, () => title),
  ])) as T
}
