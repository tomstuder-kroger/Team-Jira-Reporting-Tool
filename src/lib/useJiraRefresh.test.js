// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { renderHook, act } from '@testing-library/react'
import { useJiraRefresh } from './useJiraRefresh.js'

const ok = (body) => ({ ok: true, status: 200, json: async () => body })
const status = (over = {}) => ok({ ok: true, busy: false, startedAt: null, progress: null, ...over })

// fetch answers by path. `refresh` resolves when the test calls finishRefresh().
function setup({ initial = status(), polls = [], refreshBody } = {}) {
  const calls = []
  let pollIndex = 0
  let finishRefresh
  const refreshDone = new Promise((r) => { finishRefresh = r })
  global.fetch = vi.fn(async (url, init) => {
    calls.push([url, init?.method ?? 'GET'])
    if (url === '/api/refresh/status') return calls.filter(([u]) => u === '/api/refresh/status').length === 1 ? initial : (polls[pollIndex++] ?? status())
    if (url === '/api/refresh') { await refreshDone; return refreshBody ?? ok({ ok: true, tickets: 3, open: 2, closed: 1, historyDays: 366, pulledAt: '2026-11-18T20:00:00.000Z', warnings: [] }) }
    throw new Error(`unexpected ${url}`)
  })
  return { calls, finishRefresh }
}
const tick = (ms) => act(async () => { await vi.advanceTimersByTimeAsync(ms) })

beforeEach(() => { vi.useFakeTimers() })
afterEach(() => { vi.useRealTimers(); delete global.fetch })

describe('useJiraRefresh', () => {
  it('is idle when no refresh is running', async () => {
    setup()
    const reload = vi.fn()
    const { result } = renderHook(() => useJiraRefresh(reload))
    await tick(0)
    expect(result.current.busy).toBe(false)
    expect(reload).not.toHaveBeenCalled()
  })

  it('shows a refresh that is already running when the page loads, then reloads the data when it finishes', async () => {
    setup({
      initial: status({ busy: true, startedAt: 1000, progress: { phase: 'history', done: 10, total: 100 } }),
      polls: [status({ busy: true, startedAt: 1000, progress: { phase: 'history', done: 60, total: 100 } }), status({ busy: false })],
    })
    const reload = vi.fn()
    const { result } = renderHook(() => useJiraRefresh(reload))
    await tick(0)
    expect(result.current).toMatchObject({ busy: true, external: true, startedAt: 1000, progress: { done: 10 } })
    await tick(2000)
    expect(result.current.progress.done).toBe(60)
    expect(reload).not.toHaveBeenCalled()
    await tick(2000)
    expect(result.current.busy).toBe(false)
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('starts a refresh, follows its progress, and reports the result', async () => {
    const { finishRefresh, calls } = setup({ polls: [status({ busy: true, startedAt: 5, progress: { phase: 'tickets', done: 1, total: 6, rows: 40 } })] })
    const reload = vi.fn(async () => {})
    const { result } = renderHook(() => useJiraRefresh(reload))
    await tick(0)
    let pending
    act(() => { pending = result.current.refresh() })
    expect(result.current).toMatchObject({ busy: true, external: false, error: null })
    expect(typeof result.current.startedAt).toBe('number')
    await tick(2000)
    expect(result.current.progress).toMatchObject({ phase: 'tickets', rows: 40 })
    await act(async () => { finishRefresh(); await pending })
    expect(result.current).toMatchObject({ busy: false, error: null, progress: null, startedAt: null })
    expect(result.current.result).toMatchObject({ tickets: 3 })
    expect(reload).toHaveBeenCalledTimes(1)
    expect(calls.filter(([u, m]) => u === '/api/refresh' && m === 'POST')).toHaveLength(1)
  })

  it('does not reload by itself when its own refresh is the one running and the server says idle', async () => {
    const { finishRefresh } = setup({ polls: [status({ busy: false })] })
    const reload = vi.fn(async () => {})
    const { result } = renderHook(() => useJiraRefresh(reload))
    await tick(0)
    let pending
    act(() => { pending = result.current.refresh() })
    await tick(2000) // a poll says "not busy" before the request returns: the request's own completion handles it
    expect(result.current.busy).toBe(true)
    expect(reload).not.toHaveBeenCalled()
    await act(async () => { finishRefresh(); await pending })
    expect(reload).toHaveBeenCalledTimes(1)
  })

  it('reports a failure with the server message and clears the progress', async () => {
    const { finishRefresh } = setup({ refreshBody: { ok: false, status: 502, json: async () => ({ ok: false, error: 'Claude did not finish.' }) } })
    const { result } = renderHook(() => useJiraRefresh(vi.fn()))
    await tick(0)
    let pending
    act(() => { pending = result.current.refresh() })
    await act(async () => { finishRefresh(); await pending })
    expect(result.current).toMatchObject({ busy: false, error: 'Claude did not finish.', progress: null, startedAt: null, result: null })
  })

  it('explains a missing refresh service', async () => {
    const { finishRefresh } = setup({ refreshBody: { ok: false, status: 404, json: async () => { throw new Error('not json') } } })
    const { result } = renderHook(() => useJiraRefresh(vi.fn()))
    await tick(0)
    let pending
    act(() => { pending = result.current.refresh() })
    await act(async () => { finishRefresh(); await pending })
    expect(result.current.error).toMatch(/npm start/)
  })
})
