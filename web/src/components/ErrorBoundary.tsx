import { Component, ReactNode } from 'react'
import { Button } from './ui'

export default class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null }
  static getDerivedStateFromError(error: Error) { return { error } }
  componentDidCatch(e: Error) { console.error(e) }
  render() {
    if (!this.state.error) return this.props.children
    return <div className="grid min-h-dvh place-items-center p-6 text-center"><div><h1 className="font-display text-3xl text-thor-blue">Something went wrong</h1><p className="mx-auto mt-2 max-w-sm text-thor-text">We couldn’t open this page. Please try reloading it.</p><Button className="mt-5" onClick={() => location.assign('/')}>Reload</Button></div></div>
  }
}
