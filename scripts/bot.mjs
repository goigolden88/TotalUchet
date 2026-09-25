/**
 * Телеграм-бот — точка входа для workflow приватного репозитория (Р-23).
 *
 * Всё, что знает бот, — в `src/bot/`, чистыми функциями с тестами; здесь
 * только окружение: секреты из переменных, файл `bot.json`, сегодня,
 * настоящая сеть. Node 24 читает TypeScript без сборки — `npm ci` не нужен.
 *
 * Лог — только свои слова (Я-33, Р-01): «отправлено частей: N» или
 * причина словами. Ни среза, ни сообщения, ни токенов, ни ответов API;
 * у неожиданной ошибки — имя и места в коде, без текста.
 *
 * Переменные:
 *   READ_TOKEN, TELEGRAM_TOKEN, TELEGRAM_CHAT — секреты (Р-25)
 *   BOT_LIST   — путь к bot.json (Р-28), по умолчанию ./bot.json
 *   BOT_PERIOD — lastWeek или lastMonth (Р-24), по умолчанию lastWeek
 *   TZ         — часовой пояс человека: от него «сегодня»
 */

import { readFile } from 'node:fs/promises'
import { today } from '../src/shared/core/dates.ts'
import { LIST_FILE } from '../src/bot/list.ts'
import { READ_TOKEN_SECRET } from '../src/bot/message.ts'
import { runBot } from '../src/bot/run.ts'
import { BotError, createTelegram, TELEGRAM_CHAT_SECRET, TELEGRAM_TOKEN_SECRET } from '../src/bot/telegram.ts'

const PERIODS = ['lastWeek', 'lastMonth']

function fail(text) {
  console.error(`Бот: ${text}`)
  process.exit(1)
}

function secret(name) {
  const value = process.env[name]?.trim()
  if (!value) fail(`нет секрета ${name}`)
  return value
}

async function listText(path) {
  try {
    return await readFile(path, 'utf8')
  } catch {
    return null
  }
}

const readToken = secret(READ_TOKEN_SECRET)
const telegramToken = secret(TELEGRAM_TOKEN_SECRET)
const chat = secret(TELEGRAM_CHAT_SECRET)
const choice = process.env.BOT_PERIOD?.trim() || 'lastWeek'
if (!PERIODS.includes(choice)) fail(`BOT_PERIOD — ${PERIODS.join(' или ')}`)

try {
  const sent = await runBot({
    listText: await listText(process.env.BOT_LIST?.trim() || LIST_FILE),
    readToken,
    chat,
    choice,
    today: today(),
    telegram: createTelegram({ token: telegramToken }),
  })
  console.log(`Бот: отправлено частей: ${sent}`)
} catch (error) {
  if (error instanceof BotError) fail(error.message)
  const frames = error instanceof Error ? (error.stack ?? '').split('\n').filter((line) => line.trim().startsWith('at ')) : []
  fail(`упал — ${error instanceof Error ? error.name : typeof error}\n${frames.join('\n')}`)
}
