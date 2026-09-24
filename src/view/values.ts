/**
 * Значение среза словами — одно значение за раз (Я-15, Р-04).
 *
 * Источник истины — docs/02-Архитектура.md, «Значения словами». Каждая
 * функция берёт одно значение и отдаёт текст: ни сумм, ни средних, ни цвета.
 * Доля в процентах и деньги из минимальных единиц — форматирование одного
 * числа, а не досчёт (Я-26).
 */

import { plural, type DateStr } from '../shared/core/dates.ts'
import type { Unit, Value, Verdict } from '../shared/core/summary.ts'

const MINUTES_PER_HOUR = 60

/** Знаков после запятой у дробного числа на экране. */
const FRACTION_DIGITS = 1

/** Минус, а не дефис: «−10 %». `Intl` ставит дефис. */
const MINUS = '−'

const NUMBER = new Intl.NumberFormat('ru-RU', { maximumFractionDigits: FRACTION_DIGITS })
const PERCENT = new Intl.NumberFormat('ru-RU', { style: 'percent', maximumFractionDigits: FRACTION_DIGITS })

/** Значение на экран: текст и приглушён ли он — «не известно» приглушённо. */
export type ValueText = { text: string; muted: boolean }

const VERDICT_WORDS: Record<Verdict, string> = {
  met: 'выполнено',
  failed: 'не выполнено',
  open: 'не ясно',
}

/** Единица словами после числа. `count` — без слова: что считается, говорит подпись. */
const UNIT_FORMS: Record<Exclude<Unit, 'minutes' | 'share'>, [string, string, string] | null> = {
  count: null,
  days: ['день', 'дня', 'дней'],
  kcal: ['ккал', 'ккал', 'ккал'],
  km: ['км', 'км', 'км'],
}

function withMinus(text: string): string {
  return text.replace(/^-/, MINUS)
}

/** Число по-русски: запятая, пробел между разрядами, минус. */
export function formatNumber(n: number): string {
  return withMinus(NUMBER.format(n))
}

/** `340` → «5 ч 40 мин», `45` → «45 мин», `120` → «2 ч». Дробные минуты округляются. */
export function formatMinutes(minutes: number): string {
  const total = Math.round(Math.abs(minutes))
  const sign = minutes < 0 && total > 0 ? MINUS : ''
  const hours = Math.floor(total / MINUTES_PER_HOUR)
  const rest = total % MINUTES_PER_HOUR
  if (hours === 0) return `${sign}${rest} мин`
  if (rest === 0) return `${sign}${hours} ч`
  return `${sign}${hours} ч ${rest} мин`
}

/** Доля, 1 — целое (Я-26): `0.25` → «25 %», `-0.1` → «−10 %», `1.3` → «130 %». */
export function formatShare(share: number): string {
  return withMinus(PERCENT.format(share))
}

/**
 * Деньги из минимальных единиц: делитель — 10 в степени числа знаков
 * валюты, а не всегда 100 (у иены знаков нет).
 */
export function formatMoney(money: number, currency: string): string {
  const format = new Intl.NumberFormat('ru-RU', { style: 'currency', currency })
  const digits = format.resolvedOptions().maximumFractionDigits ?? 2
  return withMinus(format.format(money / 10 ** digits))
}

function formatAmount(n: number, unit: Unit): string {
  if (unit === 'minutes') return formatMinutes(n)
  if (unit === 'share') return formatShare(n)
  const forms = UNIT_FORMS[unit]
  const number = formatNumber(n)
  return forms ? `${number} ${plural(n, forms)}` : number
}

/** Значение показателя словами. */
export function formatValue(value: Value): ValueText {
  if ('unknown' in value) return { text: `не известно — ${value.text}`, muted: true }
  if ('verdict' in value) return { text: VERDICT_WORDS[value.verdict], muted: false }
  if ('money' in value) return { text: formatMoney(value.money, value.currency), muted: false }
  return { text: formatAmount(value.n, value.unit), muted: false }
}

/** `2026-09-07` → «07.09»: дни свежести и «за ДД.ММ». */
export function shortDate(day: DateStr): string {
  return `${day.slice(8, 10)}.${day.slice(5, 7)}`
}

/** ISO-время → «07.09 14:05»: когда прочитан срез. */
export function shortDateTime(iso: string): string {
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return iso
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${pad(at.getDate())}.${pad(at.getMonth() + 1)} ${pad(at.getHours())}:${pad(at.getMinutes())}`
}
