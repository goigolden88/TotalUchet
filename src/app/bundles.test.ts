import { describe, expect, it } from 'vitest'
import { nextOrder, ordered } from './apps.ts'
import { checkBundle, rowId, takenRows } from './bundles.ts'
import type { Bundle } from './model.ts'

/** Связки выдуманных приложений (Р-01). */

const AT = '2026-09-25T10:00:00.000Z'

function bundle(id: string, name: string, rows: Bundle['rows'], order = 1, deleted = false): Bundle {
  return { id, updatedAt: AT, name, order, rows, ...(deleted ? { deleted } : {}) }
}

const BEDS = bundle('b1', 'Огород', [
  { app: 'garden', key: 'beds.water' },
  { app: 'shelf', key: 'reading' },
])

describe('связки — записи человека (Р-17)', () => {
  it('порядок и новый порядок — как у приложений', () => {
    const list = [bundle('c', 'Бета', [], 2), bundle('a', 'Гамма', [], 1), bundle('d', 'Дельта', [], 0, true)]
    expect(ordered(list).map((one) => one.id)).toEqual(['a', 'c'])
    expect(nextOrder(list)).toBe(3)
  })

  it('занятые строки — из живых чужих связок; своя не считается', () => {
    const gone = bundle('b2', 'Убранная', [{ app: 'shelf', key: 'pages' }], 2, true)
    const taken = takenRows([BEDS, gone], null)
    expect(taken.get(rowId({ app: 'shelf', key: 'reading' }))).toBe('Огород')
    expect(taken.has(rowId({ app: 'shelf', key: 'pages' }))).toBe(false)
    expect(takenRows([BEDS], 'b1').size).toBe(0)
  })

  it('форма: имя, порядок числом, хотя бы одна строка', () => {
    expect(checkBundle({ name: ' ', order: 'x', rows: [] }, new Map())).toEqual({
      ok: false,
      problems: ['Имя не вписано', 'Порядок — число', 'Не выбрано ни одной строки'],
    })
    expect(checkBundle({ name: ' Огород ', order: '2,5', rows: BEDS.rows }, new Map())).toEqual({
      ok: true,
      fields: { name: 'Огород', order: 2.5, rows: BEDS.rows },
    })
  })

  it('строка из другой связки не проходит; повтор в форме — одна строка', () => {
    const taken = takenRows([BEDS], null)
    const result = checkBundle({ name: 'Чтение', order: '1', rows: [{ app: 'shelf', key: 'reading' }] }, taken)
    expect(result).toEqual({ ok: false, problems: ['Строка уже в связке «Огород» — одна строка живёт в одной связке'] })

    const twice = checkBundle(
      { name: 'Чтение', order: '1', rows: [{ app: 'shelf', key: 'pages' }, { app: 'shelf', key: 'pages' }] },
      new Map(),
    )
    expect(twice.ok && twice.fields.rows).toEqual([{ app: 'shelf', key: 'pages' }])
  })
})
