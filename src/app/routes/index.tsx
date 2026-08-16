import { useEffect } from 'react'
import { createFileRoute } from '@tanstack/react-router'
import LandingEventState from '../features/public/LandingEventState'

export const Route = createFileRoute('/')({
  component: IndexPage,
})

function IndexPage() {
  useEffect(() => {
    document.title = 'DemoConf 2026 — Open Events'
  }, [])

  return <LandingEventState />
}
