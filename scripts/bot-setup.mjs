/**
 * Настройка Телеграм-бота одной командой (Р-32): `npm run bot:setup`.
 *
 * Запускает человек на своём компьютере, где `gh` с входом в GitHub. Что
 * ставить — описание бота (`scripts/bot-setup.json`, другое — `--config`);
 * о «Тотальном Учёте» здесь не знают. Всё, что можно посчитать, — чистыми
 * функциями в `src/bot/setup.ts`; здесь — вопросы, файлы, Телеграм и `gh`.
 *
 * Токены — только в памяти: не печатаются, не пишутся на диск, не попадают
 * в ошибки и в командную строку — секреты уходят в `gh` через stdin.
 * Лог — шаги словами.
 *
 * `--dry-run` — только план: в сеть не ходит вовсе, ничего не меняет.
 *
 * Переменные: секреты со скрытым вводом — из переменных с тем же именем,
 * если заданы (`TELEGRAM_TOKEN`, `READ_TOKEN`).
 */

import { execFile } from 'node:child_process'
import { readFile } from 'node:fs/promises'
import { basename, dirname, resolve } from 'node:path'
import { createInterface } from 'node:readline/promises'
import { fileURLToPath } from 'node:url'
import { parseArgs } from 'node:util'
import {
  botUsername,
  chatFromUpdates,
  checkRepo,
  filePath,
  NOT_PRIVATE_CHAT,
  parseSetup,
  renderWorkflow,
  setupPlan,
  zoneHasDst,
  zoneOffset,
} from '../src/bot/setup.ts'

const HERE = dirname(fileURLToPath(import.meta.url))
const TELEGRAM = 'https://api.telegram.org/bot'

/** Ошибка, которую можно печатать: только свои слова. */
class SetupError extends Error {
  name = 'SetupError'
}

function say(text) {
  console.log(text)
}

/** Ответы не с клавиатуры — строки одного потока по порядку. */
let piped

/** Одна строка ответа; ввод кончился — ошибка, а не ожидание. */
async function line(prompt) {
  if (!process.stdin.isTTY) {
    process.stdout.write(prompt)
    piped ??= createInterface({ input: process.stdin, terminal: false })[Symbol.asyncIterator]()
    const next = await piped.next()
    if (next.done) throw new SetupError('ввод закончился, ответа нет')
    process.stdout.write('\n')
    return next.value
  }
  const rl = createInterface({ input: process.stdin, output: process.stdout })
  const closed = new Promise((_, stop) => rl.once('close', () => stop(new SetupError('прервано'))))
  closed.catch(() => {})
  rl.on('SIGINT', () => rl.close())
  try {
    return await Promise.race([rl.question(prompt), closed])
  } finally {
    rl.close()
  }
}

/** Вопрос с ответом по умолчанию. */
async function ask(question, fallback = '') {
  const answer = (await line(fallback ? `${question} [${fallback}]: ` : `${question}: `)).trim()
  return answer || fallback
}

/** Скрытый ввод: символы на экран не выводятся. */
function hidden(question) {
  const stdin = process.stdin
  if (!stdin.isTTY) return ask(question)
  return new Promise((done, stop) => {
    process.stdout.write(`${question} (ввод скрыт): `)
    let value = ''
    const finish = () => {
      stdin.off('data', onData)
      stdin.setRawMode(false)
      stdin.pause()
      process.stdout.write('\n')
    }
    function onData(chunk) {
      for (const char of String(chunk)) {
        if (char === '\r' || char === '\n') {
          finish()
          done(value.trim())
          return
        }
        if (char === '\u0003') {
          finish()
          stop(new SetupError('прервано'))
          return
        }
        if (char === '\u007f' || char === '\b') value = value.slice(0, -1)
        else if (char >= ' ') value += char
      }
    }
    stdin.setRawMode(true)
    stdin.setEncoding('utf8')
    stdin.resume()
    stdin.on('data', onData)
  })
}

/** `gh` без оболочки; `input` — в stdin. Вывод не печатается. */
function gh(args, input = '') {
  return new Promise((done) => {
    const child = execFile('gh', args, { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 }, (error, stdout, stderr) => {
      done({ ok: !error, missing: error?.code === 'ENOENT', stdout: String(stdout).trim(), stderr: String(stderr).trim() })
    })
    child.stdin?.on('error', () => {})
    child.stdin?.end(input)
  })
}

/** Первая строка ответа `gh` об ошибке — в ней нет токенов: они в `gh` не передаются. */
function ghProblem(result) {
  return result.stderr.split('\n').find((line) => line.trim() !== '')?.trim() ?? 'без объяснения'
}

async function ghOk(args, what, input = '') {
  const result = await gh(args, input)
  if (!result.ok) throw new SetupError(`${what} — не вышло: ${ghProblem(result)}`)
  return result.stdout
}

/** Вызов Bot API. Ни адреса (в нём токен), ни тела ответа в ошибках нет. */
async function telegram(token, method) {
  let response
  try {
    response = await fetch(`${TELEGRAM}${token}/${method}`, { method: 'POST' })
  } catch {
    throw new SetupError(`Телеграм недоступен: нет связи (${method})`)
  }
  if (response.status === 401 || response.status === 404) throw new SetupError('Телеграм не принял токен бота — скопируй его у @BotFather целиком')
  if (response.status === 409) throw new SetupError('у бота включён webhook — getUpdates с ним не работает; заведи бота по ручному пути')
  if (!response.ok) throw new SetupError(`Телеграм ответил ${response.status} на ${method}`)
  try {
    return await response.json()
  } catch {
    throw new SetupError(`Телеграм ответил не JSON на ${method}`)
  }
}

const pause = (ms) => new Promise((done) => setTimeout(done, ms))

/** Описание бота и шаблон рядом с ним. */
async function loadConfig(path) {
  let source
  try {
    source = await readFile(path, 'utf8')
  } catch {
    throw new SetupError(`нет описания бота: ${path}`)
  }
  const parsed = parseSetup(source)
  if (!parsed.ok) throw new SetupError(parsed.problem)
  const templatePath = resolve(dirname(path), parsed.config.workflow.template)
  try {
    return { config: parsed.config, template: await readFile(templatePath, 'utf8') }
  } catch {
    throw new SetupError(`нет шаблона workflow: ${templatePath}`)
  }
}

/** Ответы человека. В пробном показе пустой токен — можно. */
async function answers(config, template, dryRun) {
  const secrets = new Map()
  for (const secret of config.secrets) {
    if (secret.source === 'chat') continue
    const fromEnv = process.env[secret.name]?.trim()
    if (fromEnv) say(`${secret.name} — из переменной окружения.`)
    const value = fromEnv || (await hidden(dryRun ? `${secret.ask} (в пробном показе можно пропустить)` : secret.ask))
    if (!value && !dryRun) throw new SetupError(`нет значения для ${secret.name}`)
    if (value) secrets.set(secret.name, value)
  }

  const files = []
  for (const file of config.files) {
    const path = resolve(filePath(await ask(file.ask)))
    let content
    try {
      content = await readFile(path, 'utf8')
    } catch {
      throw new SetupError(`файл не читается: ${path}`)
    }
    if (content.trim() === '') throw new SetupError(`файл пуст: ${path}`)
    files.push({ path: file.path, from: path, content })
  }

  const repo = checkRepo(await ask('Имя приватного репозитория', config.repo))
  if (repo === null) throw new SetupError('имя репозитория — буквы, цифры, «.», «-», «_»; можно владелец/имя')

  const zone = await ask('Часовой пояс', Intl.DateTimeFormat().resolvedOptions().timeZone)
  const offset = zoneOffset(zone, new Date())
  if (offset === null) throw new SetupError(`не знаю пояса «${zone}» — нужно имя вида Asia/Yekaterinburg`)
  const workflow = renderWorkflow(config, template, offset)
  if (!workflow.ok) throw new SetupError(workflow.problem)

  return { secrets, files, repo, zone, offset, dst: zoneHasDst(zone, new Date().getFullYear()), workflow: workflow.text }
}

/** `gh` стоит и вошёл; у входа есть право на workflow, если `gh` о правах говорит. */
async function checkGh() {
  const status = await gh(['auth', 'status'])
  if (status.missing) throw new SetupError('нет gh — поставь GitHub CLI (cli.github.com) и войди: gh auth login')
  if (!status.ok) throw new SetupError('gh без входа в GitHub — войди: gh auth login')
  const said = `${status.stdout}\n${status.stderr}`
  if (said.includes('Token scopes') && !said.includes("'workflow'")) {
    throw new SetupError('у входа gh нет права класть workflow — дай его: gh auth refresh -s workflow, и запусти снова')
  }
}

/** Id личного чата: ждём /start и переспрашиваем. */
async function chatId(token) {
  const name = botUsername(await telegram(token, 'getMe'))
  if (name === null) throw new SetupError('Телеграм не назвал бота — проверь токен')
  for (;;) {
    const answer = await ask(`Напиши боту @${name} /start в личке Телеграма и нажми здесь Enter (q — выйти)`)
    if (answer.toLowerCase() === 'q') throw new SetupError('прервано')
    const chat = chatFromUpdates(await telegram(token, 'getUpdates'))
    switch (chat.kind) {
      case 'none':
        say('Сообщений боту пока нет.')
        continue
      case 'broken':
        throw new SetupError('Телеграм ответил на getUpdates не так, как ждали')
      case 'notPrivate':
        throw new SetupError(NOT_PRIVATE_CHAT)
      case 'chat': {
        const sure = await ask(`Последним боту писал: ${chat.name}. Это ты? (д/н)`, 'д')
        if (!['д', 'да', 'y', 'yes'].includes(sure.toLowerCase())) throw new SetupError('чат не твой — никто, кроме тебя, не должен писать боту; запусти снова')
        return chat.id
      }
    }
  }
}

/** Репозиторий: есть — должен быть приватным; нет — создаётся приватным. */
async function ensureRepo(answer) {
  const full = answer.includes('/') ? answer : `${await ghOk(['api', 'user', '--jq', '.login'], 'узнать имя на GitHub')}/${answer}`
  const found = await gh(['api', `repos/${full}`, '--jq', '.private'])
  if (found.ok) {
    if (found.stdout !== 'true') throw new SetupError(`репозиторий ${full} не приватный — секреты в него не кладутся; выбери другое имя`)
    say(`Репозиторий ${full} — есть, приватный: беру его.`)
    return full
  }
  if (!found.stderr.includes('404')) throw new SetupError(`проверить репозиторий ${full} — не вышло: ${ghProblem(found)}`)
  await ghOk(['repo', 'create', full, '--private'], `создать репозиторий ${full}`)
  say(`Репозиторий ${full} — создан, приватный.`)
  return full
}

/** Файл в репозиторий содержимым через API; тот же — не трогается. */
async function putFile(full, path, content, hint = '') {
  const address = `repos/${full}/contents/${path.split('/').map(encodeURIComponent).join('/')}`
  const found = await gh(['api', address])
  let sha
  if (found.ok) {
    const existing = JSON.parse(found.stdout)
    if (Buffer.from(String(existing.content ?? ''), 'base64').toString('utf8') === content) {
      say(`Файл ${path} — без изменений.`)
      return
    }
    sha = existing.sha
  } else if (!found.stderr.includes('404')) {
    throw new SetupError(`прочитать ${path} в репозитории — не вышло: ${ghProblem(found)}`)
  }
  const body = JSON.stringify({ message: `Настройка бота: ${path}`, content: Buffer.from(content, 'utf8').toString('base64'), ...(sha ? { sha } : {}) })
  const put = await gh(['api', '--method', 'PUT', address, '--input', '-'], body)
  if (!put.ok) throw new SetupError(`положить ${path} — не вышло: ${ghProblem(put)}${hint}`)
  say(`Файл ${path} — ${sha ? 'обновлён' : 'положен'}.`)
}

/** Пробный запуск: workflow заводится у GitHub не сразу — несколько попыток. */
async function trial(config, full) {
  const file = basename(config.workflow.path)
  const fields = Object.entries(config.trial).flatMap(([key, value]) => ['-f', `${key}=${value}`])
  let run
  for (let attempt = 0; attempt < 6; attempt += 1) {
    if (attempt > 0) await pause(5000)
    run = await gh(['workflow', 'run', file, '--repo', full, ...fields])
    if (run.ok) break
  }
  if (!run.ok) throw new SetupError(`пробный запуск — не вышло: ${ghProblem(run)}. Запусти руками: Actions → workflow → Run workflow`)
  await pause(5000)
  const list = await gh(['run', 'list', '--repo', full, '--workflow', file, '--event', 'workflow_dispatch', '--limit', '1', '--json', 'url', '--jq', '.[0].url'])
  return list.ok && list.stdout ? list.stdout : `https://github.com/${full}/actions`
}

async function main() {
  let args
  try {
    args = parseArgs({ options: { 'dry-run': { type: 'boolean', default: false }, config: { type: 'string' } } }).values
  } catch {
    throw new SetupError('ключи — --dry-run и --config <файл>')
  }
  const dryRun = args['dry-run']
  const { config, template } = await loadConfig(resolve(args.config ?? resolve(HERE, 'bot-setup.json')))

  say(`${config.title}: настройка${dryRun ? ' — пробный показ, ничего не создаётся' : ''}.`)
  const given = await answers(config, template, dryRun)

  say('\nПлан:')
  for (const step of setupPlan({ ...given, config, files: given.files.map((file) => file.from), given: new Set(given.secrets.keys()) })) say(step)

  if (dryRun) {
    say('\nПробный показ: ничего не создано, в сеть не ходил.')
    return
  }

  await checkGh()
  const secrets = new Map(given.secrets)
  const telegramSecret = config.secrets.find((secret) => secret.source === 'telegram')
  const chatSecret = config.secrets.find((secret) => secret.source === 'chat')
  if (chatSecret && telegramSecret) secrets.set(chatSecret.name, await chatId(secrets.get(telegramSecret.name)))

  const full = await ensureRepo(given.repo)
  for (const file of given.files) await putFile(full, file.path, file.content)
  await putFile(full, config.workflow.path, given.workflow, '. Если дело в праве на workflow: gh auth refresh -s workflow')
  for (const secret of config.secrets) {
    await ghOk(['secret', 'set', secret.name, '--repo', full], `секрет ${secret.name}`, secrets.get(secret.name))
    say(`Секрет ${secret.name} — задан.`)
  }
  for (const variable of config.variables) {
    await ghOk(['variable', 'set', variable.name, '--repo', full, '--body', given.zone], `переменная ${variable.name}`)
    say(`Переменная ${variable.name} — ${given.zone}.`)
  }

  const url = await trial(config, full)
  say(`\nГотово. Пробный запуск идёт — через минуту сообщение в Телеграме. Прогон: ${url}`)
}

try {
  await main()
} catch (error) {
  if (error instanceof SetupError) {
    console.error(`Настройка бота: ${error.message}`)
  } else {
    const frames = error instanceof Error ? (error.stack ?? '').split('\n').filter((line) => line.trim().startsWith('at ')) : []
    console.error(`Настройка бота: упала — ${error instanceof Error ? error.name : typeof error}\n${frames.join('\n')}`)
  }
  process.exit(1)
}
