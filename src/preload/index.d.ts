import type { McApi } from '../shared/types'

declare global {
  interface Window {
    mc?: McApi
  }
}
