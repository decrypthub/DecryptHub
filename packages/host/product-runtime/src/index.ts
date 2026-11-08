/**
 * Report the DecryptHub product runtime environment to the model.
 * @module @deepseek-ai/dsh-product-runtime
 */

import type { Context } from '@deepseek-ai/cordis'
import { defineTool } from '@deepseek-ai/dsh-tools'

/** Cordis plugin name. */
export const name = 'tool-product-runtime'
/** Services used by the tool. */
export const inject = ['tools']

/**
 * Register the product runtime tool for this composition.
 * @param ctx - context providing the tool registry.
 */
export function apply(ctx: Context): void {
  ctx.tools.register(defineTool({
    name: 'product_runtime',
    description: 'Report the running DecryptHub product runtime: product name, DSH home directory, operating-system platform, and Node version. Use when the user asks which build, product, or environment the agent is running in.',
    parameters: {},
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          product: { type: 'string', required: true, description: 'Product name reported by the running application.' },
          home: { type: 'string', required: true, description: 'Harness home directory holding profiles and session storage.' },
          platform: { type: 'string', required: true, description: 'Operating-system platform and CPU architecture.' },
          node: { type: 'string', required: true, description: 'Node.js version running the Host process.' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: `${value.product} · ${value.platform} · node ${value.node}\nDSH_HOME=${value.home}`,
      }],
    },
    async execute() {
      return {
        product: process.env.DSH_PRODUCT_NAME ?? 'DecryptHub',
        home: process.env.DSH_HOME ?? '(unset)',
        platform: `${process.platform}-${process.arch}`,
        node: process.versions.node,
      }
    },
  }))
}
