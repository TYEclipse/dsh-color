import { describe, expect, it } from 'vitest'
import { lookupNamed, NAMED_COLORS, namesByHex, searchNamed } from '../src/named.ts'

describe('NAMED_COLORS table', () => {
  it('has the full CSS Color 4 set (148 entries)', () => {
    expect(Object.keys(NAMED_COLORS).length).toBe(148)
  })

  it('anchors well-known values', () => {
    expect(NAMED_COLORS['rebeccapurple']).toBe('663399')
    expect(NAMED_COLORS['tomato']).toBe('ff6347')
    expect(NAMED_COLORS['dodgerblue']).toBe('1e90ff')
    expect(NAMED_COLORS['orange']).toBe('ffa500')
    expect(NAMED_COLORS['white']).toBe('ffffff')
    expect(NAMED_COLORS['black']).toBe('000000')
  })

  it('grey variants equal gray variants', () => {
    expect(NAMED_COLORS['gray']).toBe(NAMED_COLORS['grey'])
    expect(NAMED_COLORS['darkgray']).toBe(NAMED_COLORS['darkgrey'])
    expect(NAMED_COLORS['lightslategray']).toBe(NAMED_COLORS['lightslategrey'])
  })

  it('every hex is a valid 6-digit hex string', () => {
    for (const value of Object.values(NAMED_COLORS)) {
      expect(value).toMatch(/^[0-9a-f]{6}$/)
    }
  })
})

describe('lookupNamed', () => {
  it('is case-insensitive and trims', () => {
    expect(lookupNamed('RebeccaPurple')).toBe('663399')
    expect(lookupNamed('  tomato ')).toBe('ff6347')
    expect(lookupNamed('nope')).toBeUndefined()
  })
})

describe('namesByHex', () => {
  it('finds aliases (aqua == cyan, fuchsia == magenta)', () => {
    expect(namesByHex('00ffff')).toEqual(expect.arrayContaining(['aqua', 'cyan']))
    expect(namesByHex('ff00ff')).toEqual(expect.arrayContaining(['fuchsia', 'magenta']))
  })

  it('returns empty for unknown hex', () => {
    expect(namesByHex('123456')).toEqual([])
  })
})

describe('searchNamed', () => {
  it('matches name substrings', () => {
    const hits = searchNamed('blue')
    expect(hits.length).toBeGreaterThanOrEqual(10)
    expect(hits.map((h) => h.name)).toContain('blue')
    expect(hits.map((h) => h.name)).toContain('blueviolet')
    expect(hits.map((h) => h.name)).toContain('lightblue')
  })

  it('matches hex substrings', () => {
    const hits = searchNamed('ff6347')
    expect(hits).toEqual([{ name: 'tomato', hex: '#ff6347' }])
  })

  it('is sorted by name', () => {
    const hits = searchNamed('red')
    const names = hits.map((h) => h.name)
    expect(names).toEqual([...names].sort())
  })

  it('returns everything for an empty query', () => {
    expect(searchNamed('').length).toBe(148)
    expect(searchNamed('  ').length).toBe(148)
  })
})
