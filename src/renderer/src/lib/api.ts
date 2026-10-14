/** The one way the UI talks to the outside world: window.mc in the app; sample data only in the dev:web browser preview.
 *  In the app a missing window.mc is a broken install, so every call fails with a plain message instead of showing fake data. */
import type { McApi } from '@shared/types'
import { createMockApi } from '../mock/api'

const PREVIEW_BUILD: boolean = typeof __MC_WEB_PREVIEW__ !== 'undefined' && __MC_WEB_PREVIEW__

export const isPreview: boolean = PREVIEW_BUILD && (typeof window === 'undefined' || window.mc == null)

const BROKEN = "Options Desk's connection to its back end is missing. Close the app and open it again."

function brokenApi(): McApi {
  const fail = (): Promise<never> => Promise.reject(new Error(BROKEN))
  const none = (): (() => void) => () => undefined
  return {
    scanner: { latest: fail, run: fail, cancel: fail, onProgress: none },
    market: { quote: fail, expirations: fail, chain: fail },
    tv: { setBounds: () => undefined, show: () => undefined, back: () => undefined, reload: () => undefined, openExternal: () => undefined, signIn: () => undefined, onState: none }
  }
}

export const api: McApi = typeof window !== 'undefined' && window.mc ? window.mc : PREVIEW_BUILD ? createMockApi() : brokenApi()
