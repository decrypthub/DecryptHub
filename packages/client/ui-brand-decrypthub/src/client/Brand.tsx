import type { HeroBrandMarkOwnerProps } from '@deepseek-ai/dsh-client-ui-conversation/client'
import { MARK } from './mark.ts'

/** Product identity, unchanged by the selected interface language. */
const PRODUCT_NAME = 'DecryptHub'

/**
 * Render the existing product artwork at the declaring surface's geometry.
 * @param props - Mark size and optional host presentation class.
 * @returns the product mark without a second accessible name.
 */
export function ProductBrandMark({ size, className }: HeroBrandMarkOwnerProps) {
  return <img src={MARK} width={size} height={size} className={className} alt="" />
}

/** @returns the language-independent product name. */
export function ProductBrandName() {
  return <span style={{ fontWeight: 650, fontSize: '18px', letterSpacing: '-0.035em', whiteSpace: 'nowrap' }}>{PRODUCT_NAME}</span>
}
