import { describe, it, expect, afterEach } from 'vitest'
import { lastName, sortDesigners, filterDesigners, loadView, defaultView } from './designers.js'

// Synthetic names only.
const D = (name) => ({ name })
const names = (list) => list.map((d) => d.name)
const LIST = [D('Roe, Alex (NonEmp)'), D('Doe, Jamie A'), D('Poe, Sam'), D('Doe, Avery'), D('de la Cruz, Pat')]

describe('lastName', () => {
  it('takes the part before the comma and drops "(NonEmp)"', () => {
    expect(lastName('Doe, Jamie A')).toBe('Doe')
    expect(lastName('Roe, Alex (NonEmp)')).toBe('Roe')
    expect(lastName('Doe (NonEmp), Jamie')).toBe('Doe')
    expect(lastName('Cher')).toBe('Cher')
  })
})

describe('sortDesigners', () => {
  it('sorts by last name, then first name, A to Z and Z to A, without changing the input', () => {
    const input = [...LIST]
    expect(names(sortDesigners(input, 'az'))).toEqual(['de la Cruz, Pat', 'Doe, Avery', 'Doe, Jamie A', 'Poe, Sam', 'Roe, Alex (NonEmp)'])
    expect(names(sortDesigners(input, 'za'))).toEqual(['Roe, Alex (NonEmp)', 'Poe, Sam', 'Doe, Jamie A', 'Doe, Avery', 'de la Cruz, Pat'])
    expect(input).toEqual(LIST)
  })

  it('keeps the given order for "attention" and for an unknown mode', () => {
    expect(names(sortDesigners(LIST, 'attention'))).toEqual(names(LIST))
    expect(names(sortDesigners(LIST, 'nonsense'))).toEqual(names(LIST))
  })

  it('ignores case', () => {
    expect(names(sortDesigners([D('zed, Zoe'), D('Abel, Al')], 'az'))).toEqual(['Abel, Al', 'zed, Zoe'])
  })
})

describe('filterDesigners', () => {
  it('matches last or first name in either order, ignoring case and spaces at the ends', () => {
    expect(names(filterDesigners(LIST, 'doe'))).toEqual(['Doe, Jamie A', 'Doe, Avery'])
    expect(names(filterDesigners(LIST, '  JAMIE '))).toEqual(['Doe, Jamie A'])
    expect(names(filterDesigners(LIST, 'doe, ja'))).toEqual(['Doe, Jamie A'])
    expect(names(filterDesigners(LIST, 'jamie do'))).toEqual(['Doe, Jamie A'])
  })

  it('does not match the "(NonEmp)" tag, returns everything for empty text, and nothing for no match', () => {
    expect(filterDesigners(LIST, 'nonemp')).toEqual([])
    expect(filterDesigners(LIST, '')).toHaveLength(5)
    expect(filterDesigners(LIST, undefined)).toHaveLength(5)
    expect(filterDesigners(LIST, 'zzz')).toEqual([])
  })
})

describe('the saved layout', () => {
  afterEach(() => { delete globalThis.localStorage })
  const store = (v) => { globalThis.localStorage = { getItem: () => v, setItem() {} } }

  it('loads a saved layout and sort, and falls back to grid and needs-attention for anything else', () => {
    store(JSON.stringify({ layout: 'list', sort: 'za' }))
    expect(loadView()).toEqual({ layout: 'list', sort: 'za' })
    store(JSON.stringify({ layout: 'banana', sort: 'banana' }))
    expect(loadView()).toEqual(defaultView())
    store('{not json')
    expect(loadView()).toEqual(defaultView())
    store(null)
    expect(loadView()).toEqual(defaultView())
  })
})
