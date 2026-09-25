/**
 * Один запуск бота: чат → список → срезы → сообщение → отправка (Р-23…Р-29).
 *
 * Сначала — личный ли чат (Я-33, Р-25): нет — ничего не читается и не шлётся.
 * Список не читается — об этом сообщение в Телеграм (Р-29). Срезы читаются
 * параллельно тем же `readSummary`, что у «Сводки»; ошибка одного приложения
 * остальных не трогает. Архива у бота нет — отпечаток не сверяется.
 *
 * Сеть и Телеграм приходят параметрами: тесты — на подставных (Р-01).
 * В лог отсюда не уходит ничего: итог — число отправленных частей.
 */

import { isDateStr, type DateStr } from '../shared/core/dates.ts'
import { readSummary } from '../reading/read.ts'
import { titleOf } from '../ui/title.ts'
import { parseBotList } from './list.ts'
import { botMessage, listProblemMessage, type AppRead, type BotChoice, type MessagePart } from './message.ts'
import { BotError, type Telegram } from './telegram.ts'

/** Заголовок GitHub с днём истечения fine-grained токена. */
const EXPIRY_HEADER = 'github-authentication-token-expiration'

/** Бот пишет только в личный чат (Я-33). */
export const NOT_PRIVATE = 'чат не личный — бот пишет только в личный чат'

export type RunInput = {
  /** Текст `bot.json`; `null` — файла нет. */
  listText: string | null
  readToken: string
  chat: string
  choice: BotChoice
  today: DateStr
  telegram: Telegram
  /** Сеть к GitHub; подменяется в тестах. */
  fetch?: typeof globalThis.fetch
}

/** «2027-09-09 12:00:00 +0300» → «2027-09-09»; не дата — `null`. */
export function expiryDay(header: string | null): DateStr | null {
  const day = header?.slice(0, 10) ?? ''
  return isDateStr(day) ? day : null
}

async function send(input: RunInput, parts: readonly MessagePart[]): Promise<number> {
  for (const part of parts) await input.telegram.send(input.chat, part)
  return parts.length
}

/** Запуск. Отдаёт число отправленных частей; Телеграм недоступен — `BotError`. */
export async function runBot(input: RunInput): Promise<number> {
  if ((await input.telegram.chatType(input.chat)) !== 'private') throw new BotError(NOT_PRIVATE)

  const parsed = input.listText === null ? { ok: false as const, problem: 'файла нет' } : parseBotList(input.listText)
  if (!parsed.ok) return send(input, listProblemMessage(titleOf(null), parsed.problem))
  const { list } = parsed

  const network = input.fetch ?? globalThis.fetch
  let tokenExpires: DateStr | null = null
  const fetch: typeof globalThis.fetch = async (request, init) => {
    const response = await network(request, init)
    tokenExpires = expiryDay(response.headers.get(EXPIRY_HEADER)) ?? tokenExpires
    return response
  }

  const reads = await Promise.all(
    list.apps.map(async (app): Promise<AppRead> => {
      const result = await readSummary({ dataRepo: app.dataRepo, token: input.readToken, lastSha: null, fetch })
      switch (result.kind) {
        case 'new':
          return { app, kind: 'read', summary: result.summary }
        case 'same':
          // Без отпечатка «тот же» не бывает.
          return { app, kind: 'failed', text: 'срез не прочитан', badToken: false }
        case 'none':
        case 'broken':
          return { app, kind: 'failed', text: result.text, badToken: false }
        case 'failed':
          return { app, kind: 'failed', text: result.text, badToken: result.failure === 'badToken' }
      }
    }),
  )

  return send(
    input,
    botMessage({ title: list.title, summaryUrl: list.summaryUrl, choice: input.choice, today: input.today, reads, tokenExpires }),
  )
}
