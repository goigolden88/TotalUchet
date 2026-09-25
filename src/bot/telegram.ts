/**
 * Телеграм Bot API — ровно два вызова: какой это чат и отправка (Р-25, Р-26).
 *
 * Ошибки — свои слова, метод и код ответа. Тела ответа в них нет никогда:
 * Телеграм повторяет в нём текст сообщения (Я-33, Р-29). Адреса запроса —
 * тоже: в нём токен бота.
 */

import type { MessagePart } from './message.ts'

const API = 'https://api.telegram.org/bot'

/** Секреты бота в приватном репозитории (Р-25) — в словах ошибок. */
export const TELEGRAM_TOKEN_SECRET = 'TELEGRAM_TOKEN'
export const TELEGRAM_CHAT_SECRET = 'TELEGRAM_CHAT'

/** Ошибка, которую можно печатать в лог: только свои слова. */
export class BotError extends Error {
  override name = 'BotError'
}

export type Telegram = {
  /** Тип чата: `private`, `group`, `supergroup`, `channel`. */
  chatType(chat: string): Promise<string>
  send(chat: string, part: MessagePart): Promise<void>
}

function hint(method: string, status: number): string {
  if (status === 401 || status === 404) return ` — токен бота не принят: проверь секрет ${TELEGRAM_TOKEN_SECRET}`
  if (status === 400 && method === 'getChat') return ` — чат не найден: проверь секрет ${TELEGRAM_CHAT_SECRET} и напиши боту /start`
  if (status === 403) return ' — бот не может писать в этот чат: напиши боту /start'
  return ''
}

export function createTelegram({ token, fetch = globalThis.fetch }: { token: string; fetch?: typeof globalThis.fetch }): Telegram {
  async function call(method: string, body: Record<string, unknown>): Promise<unknown> {
    let response: Response
    try {
      response = await fetch(`${API}${token}/${method}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
    } catch {
      throw new BotError(`Телеграм недоступен: нет связи (${method})`)
    }
    if (!response.ok) throw new BotError(`Телеграм ответил ${response.status} на ${method}${hint(method, response.status)}`)
    let data: unknown
    try {
      data = await response.json()
    } catch {
      throw new BotError(`Телеграм ответил не JSON на ${method}`)
    }
    if (typeof data !== 'object' || data === null || !('ok' in data) || data.ok !== true || !('result' in data)) {
      throw new BotError(`Телеграм не выполнил ${method}`)
    }
    return data.result
  }

  return {
    async chatType(chat) {
      const result = await call('getChat', { chat_id: chat })
      return typeof result === 'object' && result !== null && 'type' in result && typeof result.type === 'string' ? result.type : ''
    },
    async send(chat, part) {
      await call('sendMessage', {
        chat_id: chat,
        text: part.html,
        parse_mode: 'HTML',
        disable_notification: part.silent,
        // Превью первой ссылки — сайт соседа — только растягивает сообщение.
        link_preview_options: { is_disabled: true },
      })
    },
  }
}
