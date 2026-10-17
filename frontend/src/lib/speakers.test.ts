import { describe, expect, it } from 'vitest'
import { speakerColour } from './speakers'

const speaker = (displayOrder: number) => ({ label: `S${displayOrder}`, displayName: '', displayOrder })

describe('speakerColour', () => {
  it('gives each of twelve speakers a colour of their own', () => {
    const colours = Array.from({ length: 12 }, (_, i) => speakerColour(speaker(i + 1)))
    expect(new Set(colours).size).toBe(12)
  })

  it('wraps around after the twelfth', () => {
    expect(speakerColour(speaker(13))).toBe(speakerColour(speaker(1)))
  })
})
