import { describe, expect, it } from 'vitest'
import { checkApp, nextOrder, normalizeSite, openLink, ordered } from './apps.ts'
import type { App } from './model.ts'

const AT = '2026-09-24T10:00:00.000Z'

function app(id: string, order: number, name: string, deleted = false): App {
  return { id, updatedAt: AT, name, dataRepo: 'someone/data', site: 'https://example.org/x/', order, ...(deleted ? { deleted } : {}) }
}

describe('приложения семьи — записи человека', () => {
  it('порядок человека, при равном — по имени; убранных нет', () => {
    const list = [app('c', 2, 'Бета'), app('a', 1, 'Гамма'), app('b', 2, 'Альфа'), app('d', 0, 'Дельта', true)]
    expect(ordered(list).map((one) => one.id)).toEqual(['a', 'b', 'c'])
  })

  it('новое — следом за последним живым', () => {
    expect(nextOrder([])).toBe(1)
    expect(nextOrder([app('a', 3, 'А'), app('b', 9, 'Б', true)])).toBe(4)
  })

  it('ссылка «открыть» — сайт и путь хеш-роутинга', () => {
    expect(openLink('https://example.org/x/', '/review')).toBe('https://example.org/x/#/review')
    expect(openLink('https://example.org/x/', 'review')).toBe('https://example.org/x/#/review')
    expect(openLink('https://example.org/x/', '')).toBe('https://example.org/x/')
  })

  it('сайт — со слешем, без хвоста экрана; не http — нет', () => {
    expect(normalizeSite('https://example.org/x')).toBe('https://example.org/x/')
    expect(normalizeSite(' https://example.org/x/#/day?y=1 ')).toBe('https://example.org/x/')
    expect(normalizeSite('ftp://example.org/x/')).toBeNull()
    expect(normalizeSite('example')).toBeNull()
  })

  it('форма: репозиторий — «владелец/имя», как бы его ни вставили', () => {
    const checked = checkApp({ name: ' Полка ', dataRepo: 'https://github.com/someone/shelf-data', site: 'https://example.org/shelf', order: '2' })
    expect(checked).toEqual({
      ok: true,
      fields: { name: 'Полка', dataRepo: 'someone/shelf-data', site: 'https://example.org/shelf/', order: 2 },
    })
  })

  it('форма: все ошибки разом', () => {
    const checked = checkApp({ name: ' ', dataRepo: 'не репозиторий', site: 'нет', order: 'x' })
    expect(checked.ok).toBe(false)
    if (!checked.ok) expect(checked.problems).toHaveLength(4)
  })
})
