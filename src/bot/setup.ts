/**
 * Настройка бота одной командой — всё, что можно посчитать (Р-32).
 *
 * Что ставить — описание бота, `scripts/bot-setup.json`: шаблон workflow,
 * секреты, переменные, файлы, часы. Здесь о «Тотальном Учёте» не знают:
 * второй бот — второе описание. Сеть, `gh`, вопросы и файлы — только
 * в `scripts/bot-setup.mjs`; здесь — чистые функции с тестами (Р-01):
 * разбор описания, время `cron` по поясу, текст workflow, разбор
 * `getUpdates`, план шагов словами. Токенов здесь нет — только имена.
 */

/** Откуда значение секрета: токен бота, другой скрытый ввод, id чата из `getUpdates`. */
export type SecretSource = 'telegram' | 'hidden' | 'chat'

export type SetupSecret = { name: string; source: SecretSource; ask: string }

/** Переменная Actions; пока одна — часовой пояс. */
export type SetupVariable = { name: string; source: 'zone' }

/** Файл, который кладётся в репозиторий; путь на диске спрашивается. */
export type SetupFile = { path: string; ask: string }

export type SetupConfig = {
  /** Чей бот — в заголовке плана. */
  title: string
  /** Где ручной путь — в отказах. */
  manual: string
  /** Имя репозитория по умолчанию. */
  repo: string
  workflow: {
    /** Шаблон — рядом с описанием. */
    template: string
    /** Путь в репозитории бота. */
    path: string
    /** Время запуска по поясу человека, `ЧЧ:ММ`. */
    time: string
    /** Пояс, под который написан шаблон, `+ЧЧ:ММ`. */
    zone: string
    /** Строки шаблона с часами — по куску текста в них. */
    lines: string[]
  }
  secrets: SetupSecret[]
  variables: SetupVariable[]
  files: SetupFile[]
  /** Поля пробного запуска. */
  trial: Record<string, string>
}

const SETUP_KIND = 'bot-setup'
const SETUP_VERSION = 1
const SOURCES: readonly string[] = ['telegram', 'hidden', 'chat']
const NAME = /^[A-Z_][A-Z0-9_]*$/
const MINUTES_IN_DAY = 24 * 60

export type ParsedSetup = { ok: true; config: SetupConfig } | { ok: false; problem: string }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : ''
}

function refuse(problem: string): ParsedSetup {
  return { ok: false, problem: `описание бота: ${problem}` }
}

/** Разбор описания. Что не так — словами, первым найденным. */
export function parseSetup(source: string): ParsedSetup {
  let raw: unknown
  try {
    raw = JSON.parse(source)
  } catch {
    return refuse('не JSON')
  }
  if (!isRecord(raw) || raw.kind !== SETUP_KIND) return refuse(`нет метки «${SETUP_KIND}»`)
  if (raw.version !== SETUP_VERSION) return refuse(`форма ${String(raw.version)}, скрипт знает ${SETUP_VERSION}`)

  const repo = text(raw.repo)
  if (checkRepo(repo) === null) return refuse('нет имени репозитория по умолчанию')

  const flow = isRecord(raw.workflow) ? raw.workflow : {}
  const lines = Array.isArray(flow.lines) ? flow.lines.map(text).filter((line) => line !== '') : []
  const workflow = { template: text(flow.template), path: text(flow.path), time: text(flow.time), zone: text(flow.zone), lines }
  if (workflow.template === '' || workflow.path === '') return refuse('нет шаблона workflow или пути для него')
  if (clockMinutes(workflow.time) === null) return refuse('время запуска — ЧЧ:ММ')
  if (parseOffset(workflow.zone) === null) return refuse('пояс шаблона — +ЧЧ:ММ')
  if (lines.length === 0) return refuse('нет строк шаблона с часами')

  const secrets: SetupSecret[] = []
  for (const item of Array.isArray(raw.secrets) ? raw.secrets : []) {
    const secret = isRecord(item) ? { name: text(item.name), source: text(item.source), ask: text(item.ask) } : null
    if (secret === null || !NAME.test(secret.name)) return refuse('у секрета нет имени из заглавных букв')
    if (!SOURCES.includes(secret.source)) return refuse(`секрет ${secret.name}: источник — ${SOURCES.join(', ')}`)
    if (secret.source !== 'chat' && secret.ask === '') return refuse(`секрет ${secret.name}: нет вопроса`)
    secrets.push({ ...secret, source: secret.source as SecretSource })
  }
  const telegram = secrets.filter((secret) => secret.source === 'telegram').length
  if (telegram > 1) return refuse('токен бота — один')
  if (telegram === 0 && secrets.some((secret) => secret.source === 'chat')) return refuse('id чата без токена бота не узнать')

  const variables: SetupVariable[] = []
  for (const item of Array.isArray(raw.variables) ? raw.variables : []) {
    const name = isRecord(item) ? text(item.name) : ''
    if (!NAME.test(name) || !isRecord(item) || item.source !== 'zone') return refuse('переменная — имя и источник «zone»')
    variables.push({ name, source: 'zone' })
  }

  const files: SetupFile[] = []
  for (const item of Array.isArray(raw.files) ? raw.files : []) {
    const file = isRecord(item) ? { path: text(item.path), ask: text(item.ask) } : { path: '', ask: '' }
    if (file.path === '' || file.ask === '') return refuse('файл — путь в репозитории и вопрос')
    files.push(file)
  }

  const trial: Record<string, string> = {}
  for (const [key, value] of Object.entries(isRecord(raw.trial) ? raw.trial : {})) {
    if (typeof value === 'string') trial[key] = value
  }

  return {
    ok: true,
    config: { title: text(raw.title), manual: text(raw.manual), repo, workflow, secrets, variables, files, trial },
  }
}

/** Имя репозитория: `имя` или `владелец/имя`; не годится — `null`. */
export function checkRepo(answer: string): string | null {
  const repo = answer.trim()
  return /^([A-Za-z0-9-]+\/)?[A-Za-z0-9._-]+$/.test(repo) ? repo : null
}

/**
 * Путь к файлу из ответа: пробелы по краям и одна пара обрамляющих кавычек
 * снимаются — Windows «Копировать как путь» даёт путь в двойных кавычках.
 * Кавычки внутри пути не трогаются.
 */
export function filePath(answer: string): string {
  const path = answer.trim()
  const quote = path[0]
  return path.length >= 2 && (quote === '"' || quote === "'") && path.endsWith(quote) ? path.slice(1, -1) : path
}

/** `09:00` → минуты от полуночи; не время — `null`. */
export function clockMinutes(clock: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(clock)
  if (!match) return null
  const hours = Number(match[1])
  const minutes = Number(match[2])
  return hours < 24 && minutes < 60 ? hours * 60 + minutes : null
}

/** `+05:00` → 300 минут к востоку от UTC; не смещение — `null`. */
export function parseOffset(offset: string): number | null {
  const match = /^([+-])(\d{2}):(\d{2})$/.exec(offset)
  if (!match) return null
  const minutes = Number(match[2]) * 60 + Number(match[3])
  return match[1] === '-' ? -minutes : minutes
}

/** 300 → `+05:00`. */
export function formatOffset(minutes: number): string {
  const size = Math.abs(minutes)
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${minutes < 0 ? '-' : '+'}${pad(Math.floor(size / 60))}:${pad(size % 60)}`
}

/** Смещение пояса от UTC в минутах в этот момент; пояса нет — `null`. */
export function zoneOffset(zone: string, at: Date): number | null {
  try {
    const parts = new Intl.DateTimeFormat('en-US', { timeZone: zone, timeZoneName: 'longOffset' }).formatToParts(at)
    const name = parts.find((part) => part.type === 'timeZoneName')?.value ?? ''
    return name === 'GMT' ? 0 : parseOffset(name.replace(/^GMT/, ''))
  } catch {
    return null
  }
}

/** Есть ли у пояса летнее время в этом году: зимой и летом смещения разные. */
export function zoneHasDst(zone: string, year: number): boolean {
  const winter = zoneOffset(zone, new Date(Date.UTC(year, 0, 1)))
  const summer = zoneOffset(zone, new Date(Date.UTC(year, 6, 1)))
  return winter !== null && summer !== null && winter !== summer
}

/** Время по UTC: минута и час `cron`. */
export type CronTime = { minute: number; hour: number }

export type Schedule = { ok: true; time: CronTime } | { ok: false; problem: string }

/**
 * Время запуска по UTC для пояса. Уходит в другие сутки по UTC — отказ:
 * сдвигаются день недели и число месяца, одной заменой часов не обойтись.
 */
export function scheduleFor(config: SetupConfig, offset: number): Schedule {
  const local = clockMinutes(config.workflow.time) ?? 0
  const utc = local - offset
  if (utc >= 0 && utc < MINUTES_IN_DAY) return { ok: true, time: { minute: utc % 60, hour: Math.floor(utc / 60) } }
  const day = utc < 0 ? 'прошлые' : 'следующие'
  return {
    ok: false,
    problem:
      `в поясе ${formatOffset(offset)} ${config.workflow.time} — это ещё ${day} сутки по UTC: в расписании сдвигаются ` +
      `день недели и число месяца, одной заменой часов этого не сделать. Заведи workflow руками: ${config.manual}`,
  }
}

const CRON = /'(\d{1,2}) (\d{1,2}) ([^']*)'/g

export type Rendered = { ok: true; text: string } | { ok: false; problem: string }

/**
 * Текст workflow из шаблона: в строках с часами — время по UTC и пояс
 * в подписи. Больше ничего не меняется. Шаблон разошёлся с описанием —
 * строки без `cron` или без своего времени — отказ.
 */
export function renderWorkflow(config: SetupConfig, template: string, offset: number): Rendered {
  const { workflow } = config
  const from = scheduleFor(config, parseOffset(workflow.zone) ?? 0)
  const to = scheduleFor(config, offset)
  if (!from.ok) return from
  if (!to.ok) return to

  const mismatch: Rendered = { ok: false, problem: `шаблон ${workflow.template} не совпадает с описанием: нет строк с часами ${workflow.time} по ${workflow.zone}` }
  const seen = new Set<string>()
  const lines: string[] = []
  for (const line of template.split('\n')) {
    const marker = workflow.lines.find((piece) => line.includes(piece))
    if (marker === undefined) {
      lines.push(line)
      continue
    }
    seen.add(marker)
    let found = false
    const changed = line.replace(CRON, (whole, minute: string, hour: string, rest: string) => {
      if (Number(minute) !== from.time.minute || Number(hour) !== from.time.hour) return whole
      found = true
      return `'${to.time.minute} ${to.time.hour} ${rest}'`
    })
    if (!found) return mismatch
    lines.push(changed.replaceAll(workflow.zone, formatOffset(offset)))
  }
  if (seen.size !== workflow.lines.length) return mismatch
  return { ok: true, text: lines.join('\n') }
}

/** Выражения `cron` из строк с часами — для плана, без повторов. */
export function cronExpressions(config: SetupConfig, workflow: string): string[] {
  const found = new Set<string>()
  for (const line of workflow.split('\n')) {
    if (!config.workflow.lines.some((piece) => line.includes(piece))) continue
    for (const match of line.matchAll(CRON)) found.add(`${match[1]} ${match[2]} ${match[3]}`)
  }
  return [...found]
}

/** Чат из ответа `getUpdates`: последний, кто писал боту. */
export type UpdatesChat =
  | { kind: 'chat'; id: string; name: string }
  | { kind: 'none' }
  | { kind: 'notPrivate'; type: string }
  | { kind: 'broken' }

/** Где в обновлении сообщение с чатом. */
const MESSAGE_KEYS = ['message', 'edited_message', 'my_chat_member', 'channel_post', 'edited_channel_post', 'chat_member']

function chatOf(update: unknown): Record<string, unknown> | null {
  if (!isRecord(update)) return null
  for (const key of MESSAGE_KEYS) {
    const message = update[key]
    if (isRecord(message) && isRecord(message.chat)) return message.chat
  }
  return null
}

/** Разбор `getUpdates`. Последний чат не личный — отказ, а не поиск личного раньше. */
export function chatFromUpdates(data: unknown): UpdatesChat {
  if (!isRecord(data) || data.ok !== true || !Array.isArray(data.result)) return { kind: 'broken' }
  const chats = data.result.map(chatOf).filter((chat) => chat !== null)
  const chat = chats.at(-1)
  if (chat === undefined) return { kind: 'none' }
  if (typeof chat.id !== 'number' && typeof chat.id !== 'string') return { kind: 'broken' }
  if (chat.type !== 'private') return { kind: 'notPrivate', type: text(chat.type) }
  const name = [text(chat.first_name), text(chat.last_name)].filter((part) => part !== '').join(' ')
  const username = text(chat.username)
  return { kind: 'chat', id: String(chat.id), name: [name, username ? `@${username}` : ''].filter((part) => part !== '').join(' ') || 'без имени' }
}

/** Имя бота из ответа `getMe`; нет — `null`. */
export function botUsername(data: unknown): string | null {
  if (!isRecord(data) || data.ok !== true || !isRecord(data.result)) return null
  const name = text(data.result.username)
  return name === '' ? null : name
}

/** Последний чат не личный — отказ словами (Я-33). */
export const NOT_PRIVATE_CHAT = 'последним боту писали не из личного чата — бот пишет только в личный: напиши ему /start в личке'

export type PlanInput = {
  config: SetupConfig
  repo: string
  zone: string
  offset: number
  dst: boolean
  /** Текст workflow после `renderWorkflow`. */
  workflow: string
  /** Путь на диске для каждого файла описания, по порядку. */
  files: string[]
  /** Какие скрытые секреты введены — только имена. */
  given: ReadonlySet<string>
}

/** План по шагам словами: имена и пути, ни одного значения секрета. */
export function setupPlan(input: PlanInput): string[] {
  const { config } = input
  const zone = `${input.zone}, ${formatOffset(input.offset)}`
  const secret = (item: SetupSecret) =>
    item.source === 'chat'
      ? `${item.name} — будет получен: id личного чата из getUpdates после /start боту`
      : `${item.name} — ${input.given.has(item.name) ? 'введён' : 'не введён'}, скрыто, на экран не выводится`
  const trial = Object.entries(config.trial).map(([key, value]) => `${key}=${value}`)

  const plan = [
    `Репозиторий ${input.repo} — приватный: будет создан или взят, если есть. Есть и не приватный — отказ`,
    ...config.files.map((file, index) => `Файл ${file.path} ← ${input.files[index] ?? ''}`),
    `Файл ${config.workflow.path} ← шаблон ${config.workflow.template}, cron: ${cronExpressions(config, input.workflow).join('; ')} — ${config.workflow.time} по ${zone}, в cron — UTC`,
    ...config.secrets.map((item) => `Секрет ${secret(item)}`),
    ...config.variables.map((item) => `Переменная ${item.name} = ${input.zone}`),
    `Пробный запуск workflow ${config.workflow.path}${trial.length > 0 ? ` (${trial.join(', ')})` : ''} и ссылка на прогон`,
  ].map((step, index) => `${index + 1}. ${step}`)

  if (input.dst) plan.push(`Внимание: у пояса ${input.zone} есть летнее время — с его сменой бот будет приходить на час раньше или позже: cron — по UTC.`)
  return plan
}
