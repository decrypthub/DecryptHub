/** Small process-boundary fixture for the official CLI's status and IDH identity output. */
import { argv, stdout } from 'node:process'

const args = argv.slice(2)
const endpoint = args[args.indexOf('--endpoint') + 1]
if (!endpoint || !args.includes('--json')) throw new Error('Expected a scoped JSON request')
if (args[0] !== 'status' && !(args[0] === 'call' && args.at(-1) === 'get_capabilities' && args.includes('--no-saved'))) {
  throw new Error('Unexpected device operation')
}
const response = await fetch(new URL(args[0], endpoint))
if (!response.ok) throw new Error('Fixture target unavailable')
stdout.write(await response.text())
