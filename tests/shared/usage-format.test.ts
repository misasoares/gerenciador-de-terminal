import { describe, expect, it } from 'vitest'
import { formatClock, formatReset } from '../../src/shared/usage-format'

describe('usage-format', () => {
  it('mesmo dia → "renova às HH:MM"; outro dia → "renova <dia> HH:MM"', () => {
    const now = new Date(2026, 8, 28, 10, 0).getTime() // seg 28/09/2026
    expect(formatClock(new Date(2026, 8, 28, 7, 5).getTime())).toBe('07:05')
    expect(formatReset(new Date(2026, 8, 28, 17, 40).getTime(), now)).toBe('renova às 17:40')
    expect(formatReset(new Date(2026, 9, 5, 9, 0).getTime(), now)).toBe('renova seg 09:00')
    expect(formatReset(new Date(2026, 9, 3, 23, 59).getTime(), now)).toBe('renova sáb 23:59')
  })
})
