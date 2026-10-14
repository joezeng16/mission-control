import { MotionConfig, motion } from 'motion/react'
import { Tooltip } from 'radix-ui'
import { useCallback, useEffect, useState, type ReactNode } from 'react'
import { Rail, TABS, type TabId } from './components/Rail'
import { TitleBar } from './components/TitleBar'
import { api } from './lib/api'
import type { CalcRequest } from './lib/calcRequest'
import { useTvState } from './lib/useTvState'
import { CalculatorTab } from './tabs/CalculatorTab'
import { ScannerTab } from './tabs/ScannerTab'

function TabPanel({ active, label, children }: { active: boolean; label: string; children: ReactNode }): React.JSX.Element {
  return (
    <motion.section
      aria-label={label}
      hidden={!active}
      inert={!active}
      initial={false}
      animate={active ? { opacity: 1, y: 0 } : { opacity: 0, y: 8 }}
      transition={{ duration: 0.26, ease: [0.16, 1, 0.3, 1] }}
      className="h-full min-h-0"
    >
      {children}
    </motion.section>
  )
}

export default function App(): React.JSX.Element {
  const [tab, setTab] = useState<TabId>('signals')
  const [calcRequest, setCalcRequest] = useState<CalcRequest | null>(null)
  const tv = useTvState()

  // A signal row's Calculate: the full request (ticker, strike/expiry or null when not live, level, live, tested, buy-back).
  const openCalculator = useCallback((req: Omit<CalcRequest, 'nonce'>) => {
    setCalcRequest({ ...req, nonce: Date.now() })
    setTab('calculator')
  }, [])

  // TradingView's sign-in page opens in the Signals tab's chart; the chart comes back once signed in
  const signInToTv = useCallback(() => {
    setTab('signals')
    api.tv.signIn()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      const i = Number(e.key) - 1
      if (i >= 0 && i < TABS.length) {
        e.preventDefault()
        setTab(TABS[i].id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <MotionConfig reducedMotion="user">
      <Tooltip.Provider delayDuration={250} skipDelayDuration={150}>
        <div className="flex h-full min-h-0 flex-col">
          <TitleBar />
          <div className="flex min-h-0 flex-1">
            <Rail active={tab} onChange={setTab} tvSignedIn={tv.signedIn} onTvSignIn={signInToTv} />
            <main className="min-h-0 min-w-0 flex-1 pb-3 pr-3">
              <TabPanel active={tab === 'signals'} label="Signals">
                <ScannerTab active={tab === 'signals'} onCalculate={openCalculator} />
              </TabPanel>
              <TabPanel active={tab === 'calculator'} label="Calculator">
                <CalculatorTab request={calcRequest} />
              </TabPanel>
            </main>
          </div>
        </div>
      </Tooltip.Provider>
    </MotionConfig>
  )
}
