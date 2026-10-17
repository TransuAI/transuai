import { describe, expect, it } from 'vitest'
import { passwordStrength } from '@/lib/password-strength'

describe('passwordStrength', () => {
  it('is too short under 12 characters, counting each character once', () => {
    expect(passwordStrength('elevenchars')).toBe('too-short')
    expect(passwordStrength('😀😀😀😀😀😀')).toBe('too-short') // 12 UTF-16 units, 6 characters
  })

  it('grows with length most of all', () => {
    expect(passwordStrength('twelve chars')).toBe('weak')
    expect(passwordStrength('sixteen chars ok')).toBe('fair')
    expect(passwordStrength('correct horse battery staple')).toBe('strong')
  })

  it('counts a mix of kinds of characters, and marks down one kind only or a repeated piece', () => {
    expect(passwordStrength('Tw3lve chars!')).toBe('fair')
    expect(passwordStrength('1234567890123456')).toBe('weak')
    expect(passwordStrength('abcdabcdabcdabcdabcd')).toBe('fair')
    expect(passwordStrength('我家的貓叫做麻糬今年三歲')).toBe('weak')
    expect(passwordStrength('我家的貓叫做麻糬，今年 3 歲了喔')).toBe('strong')
  })
})
