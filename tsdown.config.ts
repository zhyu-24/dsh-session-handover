/**
 * Standalone build config for the dsh-session-handover plugin.
 *
 * Uses the self-contained client-bundle preset mirrored into build/ (the repo
 * shared/ preset is not shipped in the tarball): node-half lib/ (handover
 * analyze/finalize API routes + parent_session_peek tool) plus the browser
 * bundle lib/client.js (closure-factory artifact for the GUI's
 * __ModuleLoader__). The client entry is auto-detected at src/client/index.ts.
 */
import { clientBundle } from './build/tsdown.client.ts'

export default clientBundle('@dsh-external/dsh-session-handover', ['src/index.ts'], {
  libExternal: [],
})
