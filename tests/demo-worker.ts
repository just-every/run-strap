import { withDemo } from '../src/modules/demo/index.mjs'
import { seedDemo } from '../src/demo'
import worker from './worker'
export default withDemo(worker, { seed: seedDemo })
