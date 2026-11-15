/** Client-side review of an edited official-component configuration. */
import { z } from 'zod'

/** One device integration row as the editor round-trips it. */
const deviceConfiguration = z.object({
  enabled: z.boolean(),
  command: z.string(),
  args: z.array(z.string()),
  endpoint: z.string(),
  devices: z.array(z.string()),
})

/** The complete namespace the editor writes; mirrors the Host schema exactly. */
export const OfficialConfigurationReview = z.object({
  revision: z.number(),
  writable: z.boolean(),
  wdh: z.object({ enabled: z.boolean(), browser: z.enum(['system', 'cloak']) }),
  adh: deviceConfiguration,
  idh: deviceConfiguration,
})

export type OfficialConfigurationReview = z.infer<typeof OfficialConfigurationReview>
