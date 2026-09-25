import { describe, expect, it } from 'vitest'
import type { App } from '../app/model.ts'
import { fakeGitHub, type FakeRepo } from '../reading/fakeGitHub.ts'
import { buildSummary, summaryFile } from '../shared/core/summary.ts'
import { shelfSummary } from '../shared/testing/shelf.ts'
import { DEFAULT_TITLE } from '../ui/title.ts'
import { botList, listText } from './list.ts'
import { expiryDay, NOT_PRIVATE, runBot, type RunInput } from './run.ts'
import { BotError, createTelegram } from './telegram.ts'

/** Всё выдуманное (Р-01): приложения, репозитории, токены, чат. 28.09.2026 — понедельник. */
const TODAY = '2026-09-28'
const TOKEN = 'fake-read-token'
const BOT_TOKEN = 'fake-bot-token'
const CHAT = '1001'
const SHELF: App = { id: 'A1', updatedAt: '', name: 'Полка', dataRepo: 'someone/shelf-data', site: 'https://example.org/shelf/', order: 1 }
const POND: App = { id: 'A2', updatedAt: '', name: 'Пруд', dataRepo: 'someone/pond-data', site: 'https://example.org/pond/', order: 2 }
const LIST = listText(botList([SHELF, POND], 'Мой учёт', 'https://example.org/meta/'))

const SLICE = summaryFile(buildSummary(shelfSummary({ sessions: [], books: [] }, '2026-09-27'), {}, '2026-09-27'))
const WITH_SLICE: FakeRepo = { files: { [SLICE.path]: SLICE.content } }

type Sent = { method: string; body: Record<string, unknown> }

/** Подставной Телеграм: тип чата, код ответа; что пришло — по порядку. */
function fakeTelegram(options: { type?: string; status?: number; offline?: boolean } = {}) {
  const sent: Sent[] = []
  const urls: string[] = []
  const fetch: typeof globalThis.fetch = async (input, init) => {
    if (options.offline) throw new TypeError('fetch failed')
    const url = String(input)
    urls.push(url)
    const method = url.slice(url.lastIndexOf('/') + 1)
    const body = JSON.parse(String(init?.body)) as Record<string, unknown>
    sent.push({ method, body })
    if (options.status) return new Response(JSON.stringify({ ok: false, description: `эхо: ${String(body.text)}` }), { status: options.status })
    const result = method === 'getChat' ? { id: Number(CHAT), type: options.type ?? 'private' } : { message_id: sent.length }
    return new Response(JSON.stringify({ ok: true, result }), { status: 200 })
  }
  return { telegram: createTelegram({ token: BOT_TOKEN, fetch }), sent, urls }
}

/** GitHub, который ещё и сообщает день истечения токена. */
function withExpiry(fetch: typeof globalThis.fetch, header: string): typeof globalThis.fetch {
  return async (input, init) => {
    const response = await fetch(input, init)
    const headers = new Headers(response.headers)
    headers.set('github-authentication-token-expiration', header)
    return new Response(await response.text(), { status: response.status, headers })
  }
}

function input(telegram: RunInput['telegram'], over: Partial<RunInput> = {}): RunInput {
  return {
    listText: LIST,
    readToken: TOKEN,
    chat: CHAT,
    choice: 'lastWeek',
    today: TODAY,
    telegram,
    fetch: fakeGitHub({ [SHELF.dataRepo]: WITH_SLICE, [POND.dataRepo]: { files: {} } }).fetch,
    ...over,
  }
}

function messages(sent: Sent[]): Sent[] {
  return sent.filter((item) => item.method === 'sendMessage')
}

describe('запуск бота (Р-23…Р-29)', () => {
  it('личный чат: читает оба приложения, шлёт одно сообщение HTML без превью', async () => {
    const { telegram, sent } = fakeTelegram()
    const github = fakeGitHub({ [SHELF.dataRepo]: WITH_SLICE, [POND.dataRepo]: { files: {} } })
    expect(await runBot(input(telegram, { fetch: github.fetch }))).toBe(1)
    expect(sent[0]).toEqual({ method: 'getChat', body: { chat_id: CHAT } })
    const [message] = messages(sent)
    expect(message?.body).toMatchObject({ chat_id: CHAT, parse_mode: 'HTML', disable_notification: false, link_preview_options: { is_disabled: true } })
    expect(message?.body.text).toContain('<b>Полка</b>\nпосчитано 27.09')
    expect(message?.body.text).toContain('<b>Пруд</b>\nсрез не отдаёт')
    // Только summary.json и только токеном чтения (Я-11, Я-34).
    expect(github.paths.filter((path) => path.includes('/git/blobs/'))).toHaveLength(1)
    expect(new Set(github.auth)).toEqual(new Set([`Bearer ${TOKEN}`]))
  })

  it('чат не личный — ничего не читается и не шлётся (Я-33, Р-25)', async () => {
    const { telegram, sent } = fakeTelegram({ type: 'group' })
    const github = fakeGitHub({ [SHELF.dataRepo]: WITH_SLICE })
    await expect(runBot(input(telegram, { fetch: github.fetch }))).rejects.toThrow(new BotError(NOT_PRIVATE))
    expect(messages(sent)).toHaveLength(0)
    expect(github.paths).toHaveLength(0)
  })

  it('401 у всех — одна строка про токен бота', async () => {
    const { telegram, sent } = fakeTelegram()
    const github = fakeGitHub({ [SHELF.dataRepo]: { status: 401 }, [POND.dataRepo]: { status: 401 } })
    await runBot(input(telegram, { fetch: github.fetch }))
    expect(messages(sent)[0]?.body.text).toContain('Токен бота не принят')
  })

  it('день истечения — из заголовка GitHub; скоро — строка в шапке', async () => {
    const { telegram, sent } = fakeTelegram()
    const github = fakeGitHub({ [SHELF.dataRepo]: WITH_SLICE, [POND.dataRepo]: WITH_SLICE })
    await runBot(input(telegram, { fetch: withExpiry(github.fetch, '2026-10-10 12:00:00 +0500') }))
    expect(messages(sent)[0]?.body.text).toContain('Токен бота истекает 10.10')
  })

  it('bot.json нет или он битый — сообщение об этом, не сводка', async () => {
    const missing = fakeTelegram()
    await runBot(input(missing.telegram, { listText: null }))
    expect(messages(missing.sent)[0]?.body.text).toBe(`<b>${DEFAULT_TITLE}</b>\nСписок приложений для бота не читается: файла нет.`)

    const broken = fakeTelegram()
    await runBot(input(broken.telegram, { listText: '{' }))
    expect(messages(broken.sent)[0]?.body.text).toContain('не читается: файл — не JSON.')
  })
})

describe('Телеграм недоступен — свои слова, без тела ответа и адреса (Р-29)', () => {
  it('отказ на отправке: код и метод; ни текста сообщения, ни токена', async () => {
    const { telegram } = fakeTelegram({ status: 400 })
    const error = await runBot(input(telegram)).catch((caught: unknown) => caught)
    expect(error).toBeInstanceOf(BotError)
    const text = (error as Error).message
    expect(text).toBe('Телеграм ответил 400 на getChat — чат не найден: проверь секрет TELEGRAM_CHAT и напиши боту /start')
    expect(text).not.toContain('эхо')
    expect(text).not.toContain(BOT_TOKEN)
  })

  it('токен бота не принят', async () => {
    const { telegram } = fakeTelegram({ status: 401 })
    await expect(runBot(input(telegram))).rejects.toThrow('токен бота не принят: проверь секрет TELEGRAM_TOKEN')
  })

  it('нет связи', async () => {
    const { telegram } = fakeTelegram({ offline: true })
    await expect(runBot(input(telegram))).rejects.toThrow(new BotError('Телеграм недоступен: нет связи (getChat)'))
  })
})

describe('день истечения токена', () => {
  it('из заголовка GitHub — день; не дата — null', () => {
    expect(expiryDay('2027-09-09 12:00:00 +0300')).toBe('2027-09-09')
    expect(expiryDay(null)).toBeNull()
    expect(expiryDay('никогда')).toBeNull()
  })
})
