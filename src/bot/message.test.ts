import { describe, expect, it } from 'vitest'
import type { App } from '../app/model.ts'
import { buildSummary, type Summary } from '../shared/core/summary.ts'
import { shelfSummary, type Session } from '../shared/testing/shelf.ts'
import { botMessage, escapeHtml, listProblemMessage, MESSAGE_LIMIT, READ_TOKEN_SECRET, type AppRead, type MessageInput } from './message.ts'

/** Выдуманные приложения и срезы «Полки» ядра (Р-01). 28.09.2026 — понедельник. */
const TODAY = '2026-09-28'
const SHELF: App = { id: 'A1', updatedAt: '', name: 'Полка', dataRepo: 'someone/shelf-data', site: 'https://example.org/shelf/', order: 1 }
const POND: App = { id: 'A2', updatedAt: '', name: 'Пруд', dataRepo: 'someone/pond-data', site: 'https://example.org/pond/', order: 2 }

const SESSIONS: Session[] = [
  { id: 's1', updatedAt: '2026-09-23T08:00:00.000Z', date: '2026-09-22', bookId: 'b', minutes: 25 },
  { id: 's2', updatedAt: '2026-09-27T08:00:00.000Z', date: '2026-09-26', bookId: 'b', minutes: 90 },
]

/** Срез, посчитанный в воскресенье: его «идущая неделя» — наша прошлая. */
function summaryOn(day: string, books: { addedOn: string | null }[] = []): Summary {
  const data = {
    sessions: SESSIONS.filter((session) => session.date <= day),
    books: books.map((book, index) => ({ id: `b${index}`, updatedAt: '', title: 'x', addedOn: book.addedOn })),
  }
  return buildSummary(shelfSummary(data, day), data, day)
}

function input(reads: AppRead[], over: Partial<MessageInput> = {}): MessageInput {
  return { title: 'Мой учёт', summaryUrl: 'https://example.org/meta/', choice: 'lastWeek', today: TODAY, reads, tokenExpires: null, ...over }
}

function text(reads: AppRead[], over: Partial<MessageInput> = {}): string {
  return botMessage(input(reads, over))
    .map((part) => part.html)
    .join('\n')
}

describe('сообщение бота — то же, что «Сводка» (Р-26)', () => {
  it('шапка, «Зовут», блок приложения, ссылка на «Сводку» — одним сообщением со звуком', () => {
    const parts = botMessage(input([{ app: SHELF, kind: 'read', summary: summaryOn('2026-09-27', [{ addedOn: null }]) }]))
    expect(parts).toHaveLength(1)
    expect(parts[0]?.silent).toBe(false)
    const html = parts[0]?.html ?? ''
    expect(html).toContain('<b>Мой учёт</b>\nПрошлая неделя · ')
    expect(html).toContain('<b>Зовут</b>: Полка')
    expect(html).toContain('Книги без даты · <b>1</b> · за 27.09 — <a href="https://example.org/shelf/#/books">открыть</a>')
    expect(html).toContain('<b>Полка</b>\nпосчитано 27.09 · по записям по 27.09\nидёт, по 27.09\n<blockquote expandable>Чтение — 1 ч 55 мин\n<i>по 2 сеансам</i></blockquote>')
    expect(html.endsWith('<a href="https://example.org/meta/">Открыть «Мой учёт»</a>')).toBe(true)
  })

  it('прошлый месяц — отрезок месяца', () => {
    expect(text([{ app: SHELF, kind: 'read', summary: summaryOn('2026-09-27') }], { choice: 'lastMonth', today: '2026-10-01' })).toContain(
      'Прошлый месяц · ',
    )
  })

  it('приложения в порядке человека; ошибка одного — строкой в его блоке, остальные как обычно', () => {
    const html = text([
      { app: POND, kind: 'failed', text: 'срез не отдаёт', badToken: false },
      { app: SHELF, kind: 'read', summary: summaryOn('2026-09-27') },
    ])
    expect(html.indexOf('<b>Полка</b>\nпосчитано')).toBeLessThan(html.indexOf('<b>Пруд</b>\nсрез не отдаёт'))
  })

  it('никто не зовёт — «не зовут», не «всё сделано» (Я-21)', () => {
    const quiet = { ...summaryOn('2026-09-27'), attention: [] }
    expect(text([{ app: SHELF, kind: 'read', summary: quiet }])).toContain('<b>Зовут</b>\nПриложения сейчас не зовут.')
  })

  it('ни одного среза — «Зовут» молчит', () => {
    expect(text([{ app: SHELF, kind: 'failed', text: 'срез не отдаёт', badToken: false }])).not.toContain('Зовут')
  })

  it('срез старше недели — «не известно», не соседняя неделя', () => {
    expect(text([{ app: SHELF, kind: 'read', summary: summaryOn('2026-09-10') }])).toContain(
      'не известно: срез посчитан 10.09, этой недели в нём нет',
    )
  })

  it('подписи и основания экранируются', () => {
    const odd: Summary = {
      ...summaryOn('2026-09-27'),
      attention: [],
      periods: summaryOn('2026-09-27').periods.map((period) =>
        'unknown' in period.metrics ? period : { ...period, metrics: [{ key: 'k', label: 'A <b> & C', value: { n: 1, unit: 'count' }, basis: '"x" < y' }] },
      ),
    }
    const html = text([{ app: { ...SHELF, name: 'Полка & <Ко>' }, kind: 'read', summary: odd }])
    expect(html).toContain('<b>Полка &amp; &lt;Ко&gt;</b>')
    expect(html).toContain('A &lt;b&gt; &amp; C — 1\n<i>&quot;x&quot; &lt; y</i>')
    expect(escapeHtml('<a href="x">')).toBe('&lt;a href=&quot;x&quot;&gt;')
  })

  it('ни одного числа, которого нет в срезе: строки — только строки хозяина (Я-15)', () => {
    const html = text([
      { app: SHELF, kind: 'read', summary: summaryOn('2026-09-27') },
      { app: POND, kind: 'read', summary: summaryOn('2026-09-27') },
    ])
    // Две «Полки» по 1 ч 55 мин — и ни одной суммы 3 ч 50 мин.
    expect(html.match(/1 ч 55 мин/g)).toHaveLength(2)
    expect(html).not.toContain('3 ч 50 мин')
  })
})

describe('токен бота (Р-29)', () => {
  it('401 у всех — одна строка наверху вместо блоков', () => {
    const html = text([
      { app: SHELF, kind: 'failed', text: 'токен не принят', badToken: true },
      { app: POND, kind: 'failed', text: 'токен не принят', badToken: true },
    ])
    expect(html).toContain(`Токен бота не принят — истёк или отозван. Выпусти новый и впиши в секрет ${READ_TOKEN_SECRET}.`)
    expect(html).not.toContain('<b>Полка</b>')
  })

  it('401 у одного — строкой в его блоке', () => {
    const html = text([
      { app: SHELF, kind: 'failed', text: 'токен не принят', badToken: true },
      { app: POND, kind: 'read', summary: summaryOn('2026-09-27') },
    ])
    expect(html).not.toContain('Токен бота не принят')
    expect(html).toContain('<b>Полка</b>\nтокен не принят')
  })

  it('истекает через 30 дней или раньше — строка в шапке; позже — нет', () => {
    const reads: AppRead[] = [{ app: SHELF, kind: 'read', summary: summaryOn('2026-09-27') }]
    expect(text(reads, { tokenExpires: '2026-10-28' })).toContain('Токен бота истекает 28.10 — выпусти новый вместе с токеном чтения приложения «Мой учёт».')
    expect(text(reads, { tokenExpires: '2026-10-29' })).not.toContain('истекает')
  })
})

describe('лимит Телеграма (Р-26)', () => {
  /** Срез с `rows` строками длинного основания в прошлой неделе. */
  function wide(rows: number): Summary {
    const base = summaryOn('2026-09-27')
    const metrics = Array.from({ length: rows }, (_, index) => ({
      key: `k${index}`,
      label: `Строка ${index}`,
      value: { n: index, unit: 'count' as const },
      basis: 'основание '.repeat(20),
    }))
    return { ...base, attention: [], periods: base.periods.map((period) => ({ ...period, metrics })) }
  }

  it('не влезло — продолжение без звука, приложения не рвутся', () => {
    const parts = botMessage(
      input([
        { app: SHELF, kind: 'read', summary: wide(12) },
        { app: POND, kind: 'read', summary: wide(12) },
      ]),
    )
    expect(parts.length).toBeGreaterThan(1)
    expect(parts.map((part) => part.silent)).toEqual([false, ...parts.slice(1).map(() => true)])
    for (const part of parts) expect(part.html.length).toBeLessThanOrEqual(MESSAGE_LIMIT)
    expect(parts.filter((part) => part.html.includes('<b>Пруд</b>'))).toHaveLength(1)
  })

  it('одно приложение больше лимита — по строкам, с тем же заголовком, ни одна строка не потеряна', () => {
    const parts = botMessage(input([{ app: SHELF, kind: 'read', summary: wide(40) }]))
    for (const part of parts) expect(part.html.length).toBeLessThanOrEqual(MESSAGE_LIMIT)
    const html = parts.map((part) => part.html).join('\n')
    expect(html.match(/<b>Полка<\/b>/g)?.length).toBeGreaterThan(1)
    for (let index = 0; index < 40; index += 1) expect(html).toContain(`Строка ${index} — `)
  })
})

describe('список не читается (Р-29)', () => {
  it('сообщение со словами причины', () => {
    expect(listProblemMessage('Мой учёт', 'файл — не JSON')).toEqual([
      { html: '<b>Мой учёт</b>\nСписок приложений для бота не читается: файл — не JSON.', silent: false },
    ])
  })
})
