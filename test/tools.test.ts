import { describe, expect, it } from 'vitest'
import { buildColorTools } from '../src/tools.ts'

const tools = buildColorTools()

describe('convert_color tool', () => {
  it('converts hex to all formats', async () => {
    const result = await tools.convert_color.execute({ input: '#ff0000' })
    expect(result.ok).toBe(true)
    expect(result.hex).toBe('#ff0000')
    expect(result.rgb).toBe('rgb(255, 0, 0)')
    expect(result.hsl).toBe('hsl(0, 100%, 50%)')
    expect(result.hwb).toBe('hwb(0 0% 0%)')
    expect(result.alpha).toBe(1)
  })

  it('resolves named colors', async () => {
    const result = await tools.convert_color.execute({ input: 'rebeccapurple', format: 'hex' })
    expect(result.ok).toBe(true)
    expect(result.hex).toBe('#663399')
    expect(result.name).toBe('rebeccapurple')
  })

  it('honors format selection', async () => {
    const result = await tools.convert_color.execute({ input: '#123456', format: 'rgb' })
    expect(result.ok).toBe(true)
    expect(result.rgb).toBe('rgb(18, 52, 86)')
    expect(result.hex).toBeUndefined()
    expect(result.hsl).toBeUndefined()
  })

  it('keeps alpha in hex output', async () => {
    const result = await tools.convert_color.execute({ input: 'rgba(255, 0, 0, 0.5)', format: 'hex' })
    expect(result.ok).toBe(true)
    expect(result.hex).toBe('#ff000080')
    expect(result.alpha).toBe(0.5)
  })

  it('reports parse failures', async () => {
    const result = await tools.convert_color.execute({ input: 'octarine' })
    expect(result.ok).toBe(false)
    expect(result.error).toContain('unrecognized')
  })

  it('parses modern space syntax', async () => {
    const result = await tools.convert_color.execute({ input: 'rgb(100% 0% 0% / 50%)', format: 'hex' })
    expect(result.ok).toBe(true)
    expect(result.hex).toBe('#ff000080')
  })
})

describe('contrast_ratio tool', () => {
  it('black on white passes AAA', async () => {
    const result = await tools.contrast_ratio.execute({ color1: '#000000', color2: '#ffffff' })
    expect(result.ok).toBe(true)
    expect(result.ratio).toBe(21)
    expect(result.level).toBe('AAA')
    expect(result.aa).toBe(true)
    expect(result.aaa).toBe(true)
  })

  it('#777777 on white fails AA for normal text, passes for large', async () => {
    const normal = await tools.contrast_ratio.execute({ color1: '#777777', color2: '#ffffff' })
    expect(normal.level).toBe('fail')
    expect(normal.aa).toBe(false)
    const large = await tools.contrast_ratio.execute({ color1: '#777777', color2: '#ffffff', textSize: 'large' })
    expect(large.level).toBe('AA')
    expect(large.aa).toBe(true)
  })

  it('accepts named and hsl inputs', async () => {
    const result = await tools.contrast_ratio.execute({ color1: 'white', color2: 'hsl(0, 100%, 50%)' })
    expect(result.ok).toBe(true)
    expect(result.ratio).toBeCloseTo(4, 1) // red on white ≈ 4.0
  })

  it('reports invalid colors', async () => {
    const result = await tools.contrast_ratio.execute({ color1: 'nope', color2: '#ffffff' })
    expect(result.ok).toBe(false)
  })
})

describe('color_info tool', () => {
  it('searches by name substring', async () => {
    const result = await tools.color_info.execute({ query: 'tomato' })
    expect(result.ok).toBe(true)
    expect(result.count).toBe(1)
    expect(result.matches[0]).toMatchObject({ name: 'tomato', hex: '#ff6347' })
    expect(result.matches[0]?.rgb).toBe('rgb(255, 99, 71)')
    expect(result.matches[0]?.luminance).toBeGreaterThan(0.2)
  })

  it('finds aliases by value', async () => {
    const result = await tools.color_info.execute({ query: '#00ffff', by: 'value' })
    expect(result.ok).toBe(true)
    const names = result.matches.map((m) => m.name)
    expect(names).toEqual(expect.arrayContaining(['aqua', 'cyan']))
  })

  it('lists colors when no query given', async () => {
    const result = await tools.color_info.execute({ limit: 5 })
    expect(result.ok).toBe(true)
    expect(result.count).toBe(148)
    expect(result.matches.length).toBe(5)
    expect(result.matches[0]?.name).toBe('aliceblue')
  })

  it('respects limit and rejects bad values', async () => {
    const result = await tools.color_info.execute({ query: 'blue', limit: 3 })
    expect(result.matches.length).toBe(3)
    const bad = await tools.color_info.execute({ query: 'octarine', by: 'value' })
    expect(bad.ok).toBe(false)
  })
})

describe('convert_color parser regression (R42)', () => {
  it('converts a mid-range legacy rgb() input to the right hex', async () => {
    const result = await tools.convert_color.execute({ input: 'rgb(51, 102, 153)', format: 'hex' })
    expect(result.ok).toBe(true)
    expect(result.hex).toBe('#336699')
  })

  it('agrees across comma, space, percentage and hex spellings of one color', async () => {
    const legacy = await tools.convert_color.execute({ input: 'rgb(51, 102, 153)', format: 'hex' })
    const modern = await tools.convert_color.execute({ input: 'rgb(51 102 153)', format: 'hex' })
    const percent = await tools.convert_color.execute({ input: 'rgb(20%, 40%, 60%)', format: 'hex' })
    const hex = await tools.convert_color.execute({ input: '#336699', format: 'hex' })
    expect(legacy.hex).toBe(hex.hex)
    expect(modern.hex).toBe(hex.hex)
    expect(percent.hex).toBe(hex.hex)
  })
})
