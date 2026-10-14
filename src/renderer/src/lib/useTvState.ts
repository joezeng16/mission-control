import { useEffect, useState } from 'react'
import type { TvState } from '@shared/types'
import { api } from './api'

const EMPTY: TvState = { url: '', symbol: null, loading: false, signedIn: null }

/** The TradingView view's latest state (symbol, loading, signed in). */
export function useTvState(): TvState {
  const [state, setState] = useState<TvState>(EMPTY)
  useEffect(() => api.tv.onState(setState), [])
  return state
}
