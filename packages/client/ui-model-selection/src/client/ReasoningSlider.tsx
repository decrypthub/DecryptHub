/** Discrete reasoning control over the Host's declared effort identities. */
import { useEffect, useRef, useState } from 'react'
import * as Slider from '@radix-ui/react-slider'
import { IconChevronRightOutlineRegular } from '@deepseek-ai/dsh-client-ui-primitives'
import css from './ReasoningSlider.module.css'

/** One supported effort; undefined preserves a provider's implicit default. */
export interface EffortChoice {
  key: string
  effort: string | undefined
  label: string
}

interface Props {
  choices: readonly EffortChoice[]
  value: string | undefined
  scope: object
  modelName: string
  modelIdentity: string
  label: string
  modelLabel: string
  disabled: boolean
  modelRef: (node: HTMLButtonElement | null) => void
  onOpenModels: () => void
  onCommit: (effort: string | undefined) => Promise<void>
  onFailure: (error: unknown) => void
}

/**
 * Preview pointer movement locally and commit the final declared effort once.
 * Async completion cannot clear a newer gesture or another directory's preview.
 * @param props - Host-supported choices, controlled selection and owned mutation callbacks.
 * @returns model entry and the discrete slider, or null for an unsupported current value.
 */
export function ReasoningSlider(props: Props) {
  const { choices, value, scope } = props
  const [draft, setDraft] = useState<number | null>(null)
  const revision = useRef(0)
  const lifetime = useRef(0)
  const signature = choices.map(choice => choice.key).join('\0')
  const owner = useRef({ scope, signature, value, model: props.modelIdentity })
  if (owner.current.scope !== scope || owner.current.signature !== signature
    || owner.current.value !== value || owner.current.model !== props.modelIdentity) {
    owner.current = { scope, signature, value, model: props.modelIdentity }
  }
  useEffect(() => { revision.current++; setDraft(null) }, [value, signature, scope, props.modelIdentity])
  useEffect(() => () => { lifetime.current++; revision.current++ }, [])
  const selected = choices.findIndex(choice => choice.effort === value)
  if (selected < 0) return null
  const current = draft ?? selected
  const commit = ([index]: number[]): void => {
    const choice = choices[index ?? -1]
    if (choice === undefined || props.disabled) return
    const mounted = lifetime.current
    const expectedOwner = owner.current
    // Radix keyboard commits precede onValueChange; pointer commits follow it.
    // Capture the completed event's revision after either order has settled.
    queueMicrotask(() => {
      if (mounted !== lifetime.current || expectedOwner !== owner.current) return
      const at = revision.current
      const finish = (): void => { if (at === revision.current && expectedOwner === owner.current) setDraft(null) }
      void Promise.resolve().then(() => props.onCommit(choice.effort)).then(finish, (error: unknown) => {
        finish()
        if (at === revision.current && expectedOwner === owner.current) props.onFailure(error)
      })
    })
  }
  return <div className={css.root}>
    <div className={css.value} aria-live="polite">{choices[current]?.label}</div>
    <button ref={props.modelRef} type="button" role="menuitem" className={css.model}
      aria-label={props.modelLabel} disabled={props.disabled} onClick={props.onOpenModels}>
      <span>{props.modelName}</span><IconChevronRightOutlineRegular />
    </button>
    <Slider.Root className={css.slider} min={0} max={Math.max(1, choices.length - 1)} step={1}
      value={[current]} disabled={props.disabled || choices.length === 1}
      onValueChange={([index]) => {
        if (index === undefined) return
        revision.current++
        setDraft(index)
      }} onValueCommit={commit}>
      <Slider.Track className={css.track}><Slider.Range className={css.range} /></Slider.Track>
      <span className={css.ticks} aria-hidden="true">{choices.map((choice, index) =>
        <i key={choice.key} data-passed={index <= current ? '' : undefined} />)}</span>
      <Slider.Thumb className={css.thumb} aria-label={props.label} aria-valuetext={choices[current]?.label} />
    </Slider.Root>
  </div>
}
