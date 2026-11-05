import { describe, it, expect } from 'vitest'
import { checkWorkloadConfig, DEFAULT_SIZE_DAYS } from './workloadConfig.js'

const base = { sizeFieldId: 'customfield_90001', rankFieldId: 'customfield_90002' }

describe('checkWorkloadConfig', () => {
  it('reports a missing block as absent, not wrong', () => {
    const r = checkWorkloadConfig(undefined)
    expect(r.ok).toBe(false)
    expect(r.absent).toBe(true)
  })

  it('fills in defaults', () => {
    const r = checkWorkloadConfig(base)
    expect(r.ok).toBe(true)
    expect(r.value.sizeDays).toEqual(DEFAULT_SIZE_DAYS)
    expect(r.value.daysPerWeek).toBe(5)
    expect(r.value.focus).toBe(1) // 40 hours a week, Monday to Friday
    expect(r.value.excludedTypes).toEqual(['Epic', 'Program Epic'])
  })

  it('rejects bad field IDs', () => {
    expect(checkWorkloadConfig({ ...base, sizeFieldId: 'size' }).ok).toBe(false)
    expect(checkWorkloadConfig({ ...base, rankFieldId: undefined }).ok).toBe(false)
  })

  it('start field is optional, and must look like a field ID when given', () => {
    expect(checkWorkloadConfig(base).value.startFieldId).toBeNull()
    expect(checkWorkloadConfig({ ...base, startFieldId: 'customfield_90003' }).value.startFieldId).toBe('customfield_90003')
    expect(checkWorkloadConfig({ ...base, startFieldId: 'start' }).ok).toBe(false)
  })

  it('rejects focus outside 0 to 1 and daysPerWeek above 5', () => {
    expect(checkWorkloadConfig({ ...base, focus: 1.2 }).ok).toBe(false)
    expect(checkWorkloadConfig({ ...base, focus: -0.1 }).ok).toBe(false)
    expect(checkWorkloadConfig({ ...base, daysPerWeek: 6 }).ok).toBe(false)
    expect(checkWorkloadConfig({ ...base, daysPerWeek: 0 }).ok).toBe(false)
  })

  it('allows focus 0 (no capacity)', () => {
    expect(checkWorkloadConfig({ ...base, focus: 0 }).ok).toBe(true)
  })

  it('rejects non-positive size days', () => {
    expect(checkWorkloadConfig({ ...base, sizeDays: { SM: 0 } }).ok).toBe(false)
    expect(checkWorkloadConfig({ ...base, sizeDays: { SM: 'five' } }).ok).toBe(false)
  })

  it('accepts overrides, ignores names no longer on the roster, and rejects bad values', () => {
    expect(checkWorkloadConfig({ ...base, overrides: { 'Doe, Jamie': { focus: 0.4 } } }).ok).toBe(true)
    expect(checkWorkloadConfig({ ...base, overrides: { 'Left, Team': { focus: 0.4 } } }).ok).toBe(true)
    expect(checkWorkloadConfig({ ...base, overrides: { 'Doe, Jamie': { focus: 2 } } }).ok).toBe(false)
    expect(checkWorkloadConfig({ ...base, overrides: { 'Doe, Jamie': { daysPerWeek: 7 } } }).ok).toBe(false)
  })

  it('never puts a value in the reason text', () => {
    const r = checkWorkloadConfig({ ...base, sizeFieldId: 'secret-looking-value' })
    expect(r.reason).not.toContain('secret-looking-value')
  })
})
