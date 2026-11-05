/** Public model-picker presentation selected by the composing application. */
import z from '@deepseek-ai/schemastery'

/** Model selection presentation; provider metadata remains authoritative for supported efforts. */
export interface Config {
  /** Use the compact menu or a discrete reasoning slider in the composer. */
  effortControl: 'menu' | 'slider'
}

/** Validate application-owned presentation without altering model capabilities. */
export const Config: z<Partial<Config>, Config> = z.object({
  effortControl: z.union(['menu', 'slider']).default('menu'),
})

/** Bootstrap key read before the client model picker registers. */
export const MODEL_PRESENTATION_GLOBAL = '__DSH_MODEL_PRESENTATION__'
