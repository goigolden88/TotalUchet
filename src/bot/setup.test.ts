import { describe, expect, it } from 'vitest'
import ownSetup from '../../scripts/bot-setup.json?raw'
import ownTemplate from '../../scripts/bot-workflow.yml?raw'
import {
  botUsername,
  chatFromUpdates,
  checkRepo,
  cronExpressions,
  formatOffset,
  parseSetup,
  renderWorkflow,
  scheduleFor,
  setupPlan,
  zoneHasDst,
  zoneOffset,
  type SetupConfig,
} from './setup.ts'

/** Выдуманный бот (Р-01): шаблон на 08:30 по +03:00. */
const DESCRIPTION = {
  kind: 'bot-setup',
  version: 1,
  title: 'Бот «Пруда»',
  manual: 'docs/руками.md',
  repo: 'pond-bot',
  workflow: { template: 'pond.yml', path: '.github/workflows/pond.yml', time: '08:30', zone: '+03:00', lines: ['- cron:', 'WHEN:'] },
  secrets: [
    { name: 'BOT_TOKEN', source: 'telegram', ask: 'Токен бота' },
    { name: 'POND_TOKEN', source: 'hidden', ask: 'Токен пруда' },
    { name: 'BOT_CHAT', source: 'chat' },
  ],
  variables: [{ name: 'TZ', source: 'zone' }],
  files: [{ path: 'pond.json', ask: 'Путь к pond.json' }],
  trial: { when: 'daily' },
}

const TEMPLATE = [
  'on:',
  '  schedule:',
  "    - cron: '30 5 * * *' # 08:30 по +03:00",
  'env:',
  "  WHEN: ${{ github.event.schedule == '30 5 * * *' && 'daily' }}",
  "  OTHER: '30 5 * * *'",
  '',
].join('\n')

function config(change: Record<string, unknown> = {}): SetupConfig {
  const parsed = parseSetup(JSON.stringify({ ...DESCRIPTION, ...change }))
  if (!parsed.ok) throw new Error(parsed.problem)
  return parsed.config
}

describe('описание бота', () => {
  it('выдуманное описание разбирается', () => {
    const pond = config()
    expect(pond.repo).toBe('pond-bot')
    expect(pond.secrets.map((secret) => secret.source)).toEqual(['telegram', 'hidden', 'chat'])
    expect(pond.trial).toEqual({ when: 'daily' })
  })

  it('что не так — словами', () => {
    expect(parseSetup('{')).toEqual({ ok: false, problem: 'описание бота: не JSON' })
    expect(parseSetup(JSON.stringify({ ...DESCRIPTION, version: 2 }))).toMatchObject({ ok: false, problem: expect.stringContaining('форма 2') })
    expect(parseSetup(JSON.stringify({ ...DESCRIPTION, workflow: { ...DESCRIPTION.workflow, time: '9:00' } }))).toMatchObject({ ok: false })
    expect(parseSetup(JSON.stringify({ ...DESCRIPTION, secrets: [{ name: 'BOT_CHAT', source: 'chat' }] }))).toMatchObject({
      ok: false,
      problem: expect.stringContaining('без токена бота'),
    })
    expect(parseSetup(JSON.stringify({ ...DESCRIPTION, secrets: [{ name: 'token', source: 'hidden', ask: '?' }] }))).toMatchObject({ ok: false })
  })

  it('имя репозитория — имя или владелец/имя', () => {
    expect(checkRepo(' pond-bot ')).toBe('pond-bot')
    expect(checkRepo('someone/pond.bot')).toBe('someone/pond.bot')
    expect(checkRepo('a/b/c')).toBeNull()
    expect(checkRepo('с пробелом')).toBeNull()
  })
})

describe('часовой пояс', () => {
  it('смещение пояса — по Intl, неизвестный пояс — null', () => {
    const winter = new Date(Date.UTC(2026, 0, 15))
    expect(zoneOffset('Asia/Yekaterinburg', winter)).toBe(300)
    expect(zoneOffset('Asia/Kolkata', winter)).toBe(330)
    expect(zoneOffset('America/New_York', winter)).toBe(-300)
    expect(zoneOffset('UTC', winter)).toBe(0)
    expect(zoneOffset('Нигде/Никак', winter)).toBeNull()
  })

  it('летнее время — у Европы есть, у Екатеринбурга нет', () => {
    expect(zoneHasDst('Europe/Berlin', 2026)).toBe(true)
    expect(zoneHasDst('Asia/Yekaterinburg', 2026)).toBe(false)
  })

  it('смещение словами', () => {
    expect(formatOffset(300)).toBe('+05:00')
    expect(formatOffset(-210)).toBe('-03:30')
    expect(formatOffset(0)).toBe('+00:00')
  })
})

describe('время cron по поясу', () => {
  it('08:30 по +03:00 — 05:30 UTC, по -03:30 — 12:00 UTC', () => {
    expect(scheduleFor(config(), 180)).toEqual({ ok: true, time: { minute: 30, hour: 5 } })
    expect(scheduleFor(config(), -210)).toEqual({ ok: true, time: { minute: 0, hour: 12 } })
  })

  it('восточнее времени запуска — прошлые сутки по UTC: отказ со ссылкой на ручной путь', () => {
    expect(scheduleFor(config(), 510)).toEqual({ ok: true, time: { minute: 0, hour: 0 } })
    const east = scheduleFor(config(), 540)
    expect(east).toMatchObject({ ok: false, problem: expect.stringContaining('прошлые сутки') })
    expect(east).toMatchObject({ problem: expect.stringContaining('docs/руками.md') })
  })

  it('поздний час на западе — следующие сутки: тоже отказ', () => {
    expect(scheduleFor(config({ workflow: { ...DESCRIPTION.workflow, time: '22:00' } }), -180)).toMatchObject({
      ok: false,
      problem: expect.stringContaining('следующие сутки'),
    })
  })
})

describe('workflow из шаблона', () => {
  it('меняются только часы в строках с часами и пояс в их подписи', () => {
    const rendered = renderWorkflow(config(), TEMPLATE, 60)
    expect(rendered).toEqual({
      ok: true,
      text: TEMPLATE.replace("'30 5 * * *' # 08:30 по +03:00", "'30 7 * * *' # 08:30 по +01:00").replace("== '30 5", "== '30 7"),
    })
    if (rendered.ok) expect(rendered.text).toContain("OTHER: '30 5 * * *'")
  })

  it('свой пояс шаблона — текст тот же', () => {
    expect(renderWorkflow(config(), TEMPLATE, 180)).toEqual({ ok: true, text: TEMPLATE })
  })

  it('шаблон разошёлся с описанием — отказ', () => {
    expect(renderWorkflow(config(), TEMPLATE.replaceAll("'30 5", "'0 5"), 60)).toMatchObject({ ok: false, problem: expect.stringContaining('не совпадает') })
    expect(renderWorkflow(config(), TEMPLATE.replace(/ {2}WHEN.*\n/, ''), 60)).toMatchObject({ ok: false })
  })

  it('пояс не годится — отказ пояса, а не шаблона', () => {
    expect(renderWorkflow(config(), TEMPLATE, 600)).toMatchObject({ ok: false, problem: expect.stringContaining('прошлые сутки') })
  })

  it('выражения cron для плана — без повторов', () => {
    expect(cronExpressions(config(), TEMPLATE)).toEqual(['30 5 * * *'])
  })
})

describe('своё описание и шаблон', () => {
  const own = parseSetup(ownSetup)

  it('разбираются; при +05:00 workflow тот же, что образец', () => {
    expect(own.ok).toBe(true)
    if (!own.ok) return
    expect(renderWorkflow(own.config, ownTemplate, 300)).toEqual({ ok: true, text: ownTemplate })
    expect(cronExpressions(own.config, ownTemplate)).toEqual(['0 4 * * 1', '0 4 1 * *'])
  })

  it('при +03:00 — 06:00 UTC в обеих строках cron и в условии отрезка', () => {
    if (!own.ok) return
    const rendered = renderWorkflow(own.config, ownTemplate, 180)
    expect(rendered.ok).toBe(true)
    if (!rendered.ok) return
    expect(cronExpressions(own.config, rendered.text)).toEqual(['0 6 * * 1', '0 6 1 * *'])
    expect(rendered.text).toContain("github.event.schedule == '0 6 1 * *'")
    expect(rendered.text).not.toContain('+05:00')
  })
})

describe('чат из getUpdates', () => {
  const update = (chat: Record<string, unknown>) => ({ update_id: 1, message: { message_id: 1, text: '/start', chat } })

  it('последний личный чат — id и имя', () => {
    const data = { ok: true, result: [update({ id: 1, type: 'private' }), update({ id: 42, type: 'private', first_name: 'Аня', username: 'anya' })] }
    expect(chatFromUpdates(data)).toEqual({ kind: 'chat', id: '42', name: 'Аня @anya' })
  })

  it('пусто — ждём; последний не личный — отказ; не тот ответ — сломан', () => {
    expect(chatFromUpdates({ ok: true, result: [] })).toEqual({ kind: 'none' })
    expect(chatFromUpdates({ ok: true, result: [update({ id: 1, type: 'private' }), update({ id: -5, type: 'group' })] })).toEqual({
      kind: 'notPrivate',
      type: 'group',
    })
    expect(chatFromUpdates({ ok: false })).toEqual({ kind: 'broken' })
  })

  it('имя бота из getMe', () => {
    expect(botUsername({ ok: true, result: { username: 'pond_bot' } })).toBe('pond_bot')
    expect(botUsername({ ok: true, result: {} })).toBeNull()
  })
})

describe('план', () => {
  const pond = config()
  const plan = setupPlan({
    config: pond,
    repo: 'pond-bot',
    zone: 'Europe/Somewhere',
    offset: 60,
    dst: true,
    workflow: TEMPLATE.replaceAll("'30 5", "'30 7"),
    files: ['/home/someone/pond.json'],
    given: new Set(['BOT_TOKEN']),
  })

  it('по шагам: репозиторий, файлы, cron, секреты по именам, переменная, пробный запуск', () => {
    expect(plan[0]).toMatch(/^1\. Репозиторий pond-bot — приватный: будет создан или взят/)
    expect(plan).toContain('2. Файл pond.json ← /home/someone/pond.json')
    expect(plan[2]).toContain('cron: 30 7 * * *')
    expect(plan[2]).toContain('08:30 по Europe/Somewhere, +01:00')
    expect(plan.some((step) => step.includes('BOT_TOKEN — введён'))).toBe(true)
    expect(plan.some((step) => step.includes('POND_TOKEN — не введён'))).toBe(true)
    expect(plan.some((step) => step.includes('BOT_CHAT — будет получен'))).toBe(true)
    expect(plan).toContain('7. Переменная TZ = Europe/Somewhere')
    expect(plan).toContain('8. Пробный запуск workflow .github/workflows/pond.yml (when=daily) и ссылка на прогон')
  })

  it('летнее время — предупреждение последней строкой', () => {
    expect(plan.at(-1)).toContain('летнее время')
  })
})
