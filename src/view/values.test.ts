import { describe, expect, it } from 'vitest'
import { formatMinutes, formatMoney, formatNumber, formatShare, formatValue, shortDate, shortDateTime } from './values.ts'

/** Пробелы `Intl` — неразрывные; сравниваем по смыслу, а не по виду пробела. */
function plain(text: string): string {
  return text.replace(/[  ]/g, ' ')
}

describe('значение словами — одно за раз (Я-15)', () => {
  it('минуты — часы и минуты', () => {
    expect(formatMinutes(340)).toBe('5 ч 40 мин')
    expect(formatMinutes(45)).toBe('45 мин')
    expect(formatMinutes(120)).toBe('2 ч')
    expect(formatMinutes(0)).toBe('0 мин')
    expect(formatMinutes(59.6)).toBe('1 ч')
    expect(formatMinutes(-90)).toBe('−1 ч 30 мин')
  })

  it('доля — проценты, 1 — целое, отрезком 0…1 не ограничена (Я-26)', () => {
    expect(plain(formatShare(0.25))).toBe('25 %')
    expect(plain(formatShare(-0.1))).toBe('−10 %')
    expect(plain(formatShare(1.3))).toBe('130 %')
    expect(plain(formatShare(0.125))).toBe('12,5 %')
  })

  it('деньги — делитель по знакам валюты, не всегда 100', () => {
    expect(plain(formatMoney(123450, 'RUB'))).toBe('1 234,50 ₽')
    expect(plain(formatMoney(-500, 'RUB'))).toBe('−5,00 ₽')
    expect(plain(formatMoney(1500, 'JPY'))).toMatch(/^1 500/)
  })

  it('число — по-русски, с единицей и склонением', () => {
    expect(plain(formatNumber(12345.67))).toBe('12 345,7')
    expect(formatValue({ n: 1, unit: 'days' }).text).toBe('1 день')
    expect(formatValue({ n: 3, unit: 'days' }).text).toBe('3 дня')
    expect(formatValue({ n: 11, unit: 'days' }).text).toBe('11 дней')
    expect(formatValue({ n: 3.5, unit: 'days' }).text).toBe('3,5 дня')
    expect(plain(formatValue({ n: 1850, unit: 'kcal' }).text)).toBe('1 850 ккал')
    expect(formatValue({ n: 4.25, unit: 'km' }).text).toBe('4,3 км')
    expect(formatValue({ n: 7, unit: 'count' }).text).toBe('7')
  })

  it('вердикт — словами, «не известно» — словами хозяина и приглушённо', () => {
    expect(formatValue({ verdict: 'met' })).toEqual({ text: 'выполнено', muted: false })
    expect(formatValue({ verdict: 'failed' })).toEqual({ text: 'не выполнено', muted: false })
    expect(formatValue({ verdict: 'open' })).toEqual({ text: 'не ясно', muted: false })
    expect(formatValue({ unknown: 'no-data', text: 'сеансов нет' })).toEqual({ text: 'не известно — сеансов нет', muted: true })
  })

  it('короткая дата — ДД.ММ; время прочтения — ДД.ММ ЧЧ:ММ по часам устройства', () => {
    expect(shortDate('2026-09-07')).toBe('07.09')
    expect(shortDateTime(new Date(2026, 8, 7, 9, 5).toISOString())).toBe('07.09 09:05')
    expect(shortDateTime('не время')).toBe('не время')
  })
})
