/**
 * Сообщение Телеграм-бота — то же, что «Сводка» (Я-33, Р-26).
 *
 * Шапка, «Зовут», блок каждого приложения, ссылка на «Сводку» — теми же
 * функциями `view/`, что экран: ничего не считается (Я-15), своих слов
 * о данных нет. Блоки — сворачиваемой цитатой Телеграма
 * (`blockquote expandable`), аналогом `Fold`: снаружи то, что у свёрнутого
 * на экране, внутри — строки с основаниями.
 *
 * Разметка — HTML Bot API. Всё, что пришло из среза или списка, экранируется.
 * Сообщение режется на части по лимиту Телеграма целыми блоками; блок
 * больше лимита — по строкам.
 */

import { ordered } from '../app/apps.ts'
import type { App } from '../app/model.ts'
import { daysBetween, formatPeriod, type DateStr } from '../shared/core/dates.ts'
import type { Summary } from '../shared/core/summary.ts'
import { calls } from '../view/attention.ts'
import { appBlock, type BlockRow } from '../view/block.ts'
import { CHOICES, screenPeriod, type Choice } from '../view/periods.ts'
import { shortDate } from '../view/values.ts'

/** Лимит знаков одного сообщения Bot API. Считаем по разметке — с запасом. */
export const MESSAGE_LIMIT = 4096

/**
 * За сколько дней до истечения токена бот предупреждает. То же число, что
 * `WARN_DAYS` ядра, — тот лежит в файле интерфейса, а Node `.tsx` не запускает (Р-29).
 */
export const WARN_DAYS = 30

/** Секрет с токеном чтения бота в приватном репозитории (Р-25). */
export const READ_TOKEN_SECRET = 'READ_TOKEN'

/** Отрезки, которые бот шлёт по расписанию (Р-24). */
export type BotChoice = Extract<Choice, 'lastWeek' | 'lastMonth'>

/** Итог чтения одного приложения. */
export type AppRead =
  | { app: App; kind: 'read'; summary: Summary }
  /** Не прочитан или среза не отдаёт — слова «Сводки»; `badToken` — 401. */
  | { app: App; kind: 'failed'; text: string; badToken: boolean }

export type MessageInput = {
  title: string
  summaryUrl: string
  choice: BotChoice
  today: DateStr
  reads: readonly AppRead[]
  /** День истечения токена чтения из заголовка GitHub; `null` — не сообщил. */
  tokenExpires: DateStr | null
}

/** Часть сообщения и слать ли её со звуком: со звуком — только первая. */
export type MessagePart = { html: string; silent: boolean }

const JOIN = '\n\n'

/** Текст в HTML Bot API: `&`, `<`, `>` и кавычка — для адресов в атрибуте. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
}

function link(href: string, text: string): string {
  return `<a href="${escapeHtml(href)}">${escapeHtml(text)}</a>`
}

function quote(lines: readonly string[]): string {
  return `<blockquote expandable>${lines.join('\n')}</blockquote>`
}

function header(input: MessageInput, allBadToken: boolean): string {
  const screen = screenPeriod(input.choice, input.today)
  const label = CHOICES.find((item) => item.id === input.choice)?.label ?? ''
  const lines = [`<b>${escapeHtml(input.title)}</b>`, `${label} · ${formatPeriod(screen)}`]
  if (allBadToken) {
    lines.push(`Токен бота не принят — истёк или отозван. Выпусти новый и впиши в секрет ${READ_TOKEN_SECRET}.`)
  } else if (input.tokenExpires !== null) {
    const left = daysBetween(input.today, input.tokenExpires)
    if (left >= 0 && left <= WARN_DAYS) {
      lines.push(
        `Токен бота истекает ${shortDate(input.tokenExpires)} — выпусти новый вместе с токеном чтения приложения «${escapeHtml(input.title)}».`,
      )
    }
  }
  return lines.join('\n')
}

/** «Зовут» — как на экране: снаружи кто зовёт, внутри пункты со ссылкой «открыть». */
function callsSection(reads: readonly AppRead[]): string | null {
  const latest = new Map<string, Summary>()
  for (const read of reads) if (read.kind === 'read') latest.set(read.app.id, read.summary)
  const calling = calls(
    reads.map((read) => read.app),
    latest,
  )
  if (!calling.anySeen) return null
  if (calling.groups.length === 0) return '<b>Зовут</b>\nПриложения сейчас не зовут.'
  const lines: string[] = []
  for (const group of calling.groups) {
    lines.push(`<b>${escapeHtml(group.app.name)}</b>`)
    for (const item of group.items) {
      const count = item.count ? ` · <b>${escapeHtml(item.count)}</b>` : ''
      lines.push(`${escapeHtml(item.label)}${count} · ${escapeHtml(item.day)} — ${link(item.href, 'открыть')}`)
      lines.push(`<i>${escapeHtml(item.basis)}</i>`)
    }
  }
  const names = calling.groups.map((group) => escapeHtml(group.app.name)).join(', ')
  return `<b>Зовут</b>: ${names}\n${quote(lines)}`
}

function rowLines(row: BlockRow): string[] {
  return [`${escapeHtml(row.label)} — ${escapeHtml(row.value.text)}`, `<i>${escapeHtml(row.basis)}</i>`]
}

/**
 * Блок приложения — одна или несколько частей: строки, не влезшие в лимит,
 * уходят следующей частью с тем же заголовком.
 */
function appSections(read: AppRead, input: MessageInput): string[] {
  const name = `<b>${escapeHtml(read.app.name)}</b>`
  if (read.kind === 'failed') return [`${name}\n${escapeHtml(read.text)}`]

  const block = appBlock(read.summary, screenPeriod(input.choice, input.today))
  const head = [name, escapeHtml(block.freshness)]
  const { body } = block
  if (body.kind === 'missing') return [[...head, escapeHtml(body.text)].join('\n')]
  if (body.going) head.push(escapeHtml(body.going))
  if (body.kind === 'unknown') return [[...head, escapeHtml(body.text)].join('\n')]
  if (body.rows.length === 0) return [head.join('\n')]

  const sections: string[] = []
  let lines: string[] = []
  const render = (rows: string[]) => `${head.join('\n')}\n${quote(rows)}`
  for (const row of body.rows) {
    const next = [...lines, ...rowLines(row)]
    if (lines.length > 0 && render(next).length > MESSAGE_LIMIT) {
      sections.push(render(lines))
      lines = rowLines(row)
    } else {
      lines = next
    }
  }
  sections.push(render(lines))
  return sections
}

/** Части сообщения по лимиту: блоки не рвутся; первая — со звуком, остальные — без (Р-26). */
function pack(sections: readonly string[]): MessagePart[] {
  const parts: string[] = []
  let current = ''
  for (const section of sections) {
    const joined = current === '' ? section : `${current}${JOIN}${section}`
    if (current !== '' && joined.length > MESSAGE_LIMIT) {
      parts.push(current)
      current = section
    } else {
      current = joined
    }
  }
  if (current !== '') parts.push(current)
  return parts.map((html, index) => ({ html, silent: index > 0 }))
}

/** Сообщение бота на отрезок. */
export function botMessage(input: MessageInput): MessagePart[] {
  const reads = ordered(input.reads.map((read) => ({ ...read.app, read }))).map((item) => item.read)
  const allBadToken = reads.length > 0 && reads.every((read) => read.kind === 'failed' && read.badToken)

  const sections = [header(input, allBadToken)]
  if (reads.length === 0) sections.push('В списке для бота нет приложений.')
  if (!allBadToken) {
    const called = callsSection(reads)
    if (called) sections.push(called)
    for (const read of reads) sections.push(...appSections(read, input))
  }
  sections.push(link(input.summaryUrl, `Открыть «${input.title}»`))
  return pack(sections)
}

/** Сообщение, когда список приложений не читается (Р-29). */
export function listProblemMessage(title: string, problem: string): MessagePart[] {
  return [{ html: `<b>${escapeHtml(title)}</b>\nСписок приложений для бота не читается: ${escapeHtml(problem)}.`, silent: false }]
}
