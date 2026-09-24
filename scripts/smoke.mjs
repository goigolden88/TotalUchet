/**
 * Прогон собранного приложения в настоящем браузере — обвязка.
 *
 * Отвечает на один вопрос: открывается ли приложение и не падает ли оно
 * на обычном пути. Не проверяет вёрстку и не заменяет тесты расчёта.
 *
 * Без Playwright: уже установленный браузер на Chromium и протокол отладки
 * поверх WebSocket, встроенного в Node 22+. Ни одной зависимости, кроме Vite
 * самого проекта.
 *
 * Данные не трогает: браузер запускается с пустым временным профилем.
 *
 * Запуск: `npm run smoke`. Собирает сам, поэтому проверяет ровно тот код,
 * который лежит в `src/` сейчас. Падает с кодом 1, если браузер сообщил
 * об ошибке или проверка не сошлась.
 *
 * Обвязка — скилла `browser-smoke-cdp` как есть; сценарий — этого проекта.
 */

import { spawn } from 'node:child_process'
import { build, preview } from 'vite'
import { existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
// Имя по умолчанию — из того же места, что у приложения (Р-03): Node 24
// читает TypeScript без сборки, а в title.ts нет ничего, кроме строк.
import { DEFAULT_TITLE } from '../src/ui/title.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Адрес собранного приложения. Заполняется, когда поднимется сервер. */
let APP = ''

/** Свой порт отладки, чтобы не столкнуться с открытым браузером. */
const DEBUG_PORT = 9333

/** Где искать браузер. Годится любой на Chromium. Свой путь — CHROME_PATH. */
const BROWSERS = [
  process.env.CHROME_PATH,
  'C:/Program Files/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe',
  'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe',
  '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  '/usr/bin/google-chrome',
  '/usr/bin/chromium',
]

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

// ─── Запуск ────────────────────────────────────────────────────────────────

function findBrowser() {
  const found = BROWSERS.find((path) => path && existsSync(path))
  if (!found) throw new Error('Браузер на Chromium не найден. Укажите путь в переменной CHROME_PATH.')
  return found
}

/**
 * Собирает и поднимает просмотр через API Vite, а не `npm run preview`:
 * на Windows Node не запускает `.cmd` без оболочки. Адрес — у самого
 * сервера, вместе с `base` из vite.config.ts.
 *
 * Собираем сами, а не полагаемся на dist от прошлого раза: прогон, который
 * молча проверяет вчерашнюю сборку, показывает зелёное на сломанном коде.
 */
async function startServer() {
  await build({ root: ROOT, logLevel: 'warn' })
  const server = await preview({ root: ROOT })
  const url = server.resolvedUrls?.local?.[0]
  if (!url) {
    await server.close()
    throw new Error('Сервер просмотра не назвал адрес')
  }
  APP = url
  return server
}

/** Адрес вкладки в протоколе отладки. */
async function pageSocket() {
  for (let i = 0; i < 40; i++) {
    try {
      const tabs = await fetch(`http://127.0.0.1:${DEBUG_PORT}/json/list`).then((r) => r.json())
      const page = tabs.find((tab) => tab.type === 'page')
      if (page) return page.webSocketDebuggerUrl
    } catch {
      // Браузер ещё не открыл порт.
    }
    await sleep(250)
  }
  throw new Error('Браузер не отдал порт отладки')
}

// ─── Разговор с браузером ──────────────────────────────────────────────────

/** Ошибки, о которых сообщил сам браузер. Любая валит прогон. */
const problems = []

/** Проверки сценария. */
const checks = []

function check(what, passed, seen = '') {
  checks.push({ what, passed, seen })
}

let socket
let seq = 0
const waiting = new Map()

function connect(url) {
  socket = new WebSocket(url)

  socket.onmessage = (event) => {
    const message = JSON.parse(event.data)

    if (message.id !== undefined) {
      waiting.get(message.id)?.(message)
      waiting.delete(message.id)
      return
    }

    if (message.method === 'Runtime.exceptionThrown') {
      const details = message.params.exceptionDetails
      problems.push(details.exception?.description ?? details.text)
    }

    if (message.method === 'Runtime.consoleAPICalled' && message.params.type === 'error') {
      problems.push(message.params.args.map((arg) => arg.value ?? arg.description).join(' '))
    }
  }

  return new Promise((done, fail) => {
    socket.onopen = done
    socket.onerror = fail
  })
}

/** Команда протокола. Ответ с ошибкой приходит без `result` — вернётся undefined. */
function send(method, params = {}) {
  const id = ++seq
  return new Promise((done) => {
    waiting.set(id, (message) => done(message.result))
    socket.send(JSON.stringify({ id, method, params }))
  })
}

/**
 * Выполняет выражение на странице. Исключение здесь — тоже ошибка прогона:
 * не нашлась кнопка — значит экран не тот, каким его считали.
 */
async function run(expression) {
  const result = await send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true })
  if (!result) {
    problems.push(`протокол не ответил на выражение: ${expression.slice(0, 60)}`)
    return null
  }
  if (result.exceptionDetails) {
    problems.push(result.exceptionDetails.exception?.description ?? 'ошибка в сценарии')
    return null
  }
  return result.result.value
}

/**
 * Помощники внутри каждого шага.
 *
 * `set` пишет в поле как человек: React слушает не присваивание `value`,
 * а событие с нативного сеттера. `blur` — через focusout: обычный blur
 * не всплывает, и onBlur его не увидит.
 *
 * Кончаются точкой с запятой: шаг, начатый с `[` или `(`, иначе склеился бы
 * с последней строкой в одно выражение.
 */
const HELPERS = `
  const set = (el, value) => {
    const setter = Object.getOwnPropertyDescriptor(el.constructor.prototype, 'value').set;
    setter.call(el, value);
    el.dispatchEvent(new Event('input', { bubbles: true }));
  };
  const blur = (el) => {
    el.blur();
    el.dispatchEvent(new FocusEvent('focusout', { bubbles: true }));
  };
  const byText = (tag, label) =>
    [...document.querySelectorAll(tag)].find((el) => el.textContent.trim() === label);
  const startsWith = (tag, prefix) =>
    [...document.querySelectorAll(tag)].find((el) => el.textContent.trim().startsWith(prefix));
`

/** Шаг сценария: тело выполняется на странице с помощниками выше. */
const act = (body) => run(`(() => {${HELPERS}\n${body}\n})()`)

/** Текст всего экрана. По нему и делаются проверки. Корень — поправить под проект. */
const screen = () => run('document.querySelector("#root")?.innerText ?? ""')

/**
 * Есть ли на экране такой текст — без учёта регистра и неразрывных пробелов.
 * `innerText` отдаёт `text-transform`: заголовки капителью приходят прописными,
 * и проверка «этого больше нет» иначе проходит ложно.
 */
function has(text, needle) {
  const flat = (value) => value.replace(/\u00A0/g, ' ').toLowerCase()
  return flat(text).includes(flat(needle))
}

/** Строка экрана с образцом — для внятного отчёта о непрошедшем. */
function line(text, part) {
  const flat = (value) => value.replace(/\u00A0/g, ' ')
  return flat(text).split('\n').find((each) => each.toLowerCase().includes(part.toLowerCase())) ?? ''
}

/** Переход по хеш-роутингу с ожиданием перерисовки. */
async function go(hash) {
  await run(`location.hash = ${JSON.stringify(hash)}`)
  await sleep(700)
}

/** Ждёт, пока выражение на странице станет истинным. */
async function waitFor(expression, ms = 10_000) {
  for (let spent = 0; spent < ms; spent += 250) {
    if ((await run(`Boolean(${expression})`)) === true) return true
    await sleep(250)
  }
  return false
}

/** Сеть вкл/выкл — для проверки работы из кеша service worker. */
async function offline(on) {
  await send('Network.enable')
  await send('Network.emulateNetworkConditions', {
    offline: on,
    latency: 0,
    downloadThroughput: -1,
    uploadThroughput: -1,
  })
}

// ─── Сценарий ──────────────────────────────────────────────────────────────

/**
 * Обычный путь человека. Ровно то, что делают каждый день; экраны, куда
 * никто не ходит, сюда добавлять незачем.
 */
async function scenario(profile) {
  await send('Runtime.enable')
  await send('Page.enable')

  // Скачанное — во временный профиль, который удаляется после прогона.
  // Без этого headless Chrome кладёт файлы в «Загрузки» человека.
  await send('Page.setDownloadBehavior', { behavior: 'allow', downloadPath: profile })

  await send('Page.navigate', { url: APP })
  await sleep(2000)

  // ── «Сводка»: шапка с названием, вкладки, место будущей сводки.
  const start = await screen()
  check('«Сводка» открылась с названием по умолчанию', has(start, DEFAULT_TITLE), start.replace(/\s+/g, ' ').slice(0, 80))
  check('вкладки «Сводка» и «Семья»', has(start, 'Сводка') && has(start, 'Семья'))
  check('свежей установке «Что нового» не показано', !has(start, 'Что нового'))
  check('заголовок вкладки — название', (await run('document.title')) === DEFAULT_TITLE)

  // ── «Семья» — вкладкой, по адресу.
  await act(`document.querySelector('nav.tabs a[href="#/family"]').click();`)
  await sleep(700)
  const family = await screen()
  check('«Семья» открылась вкладкой', has(family, 'приложения семьи'), line(family, 'приложения'))

  // ── Незнакомый адрес — на «Сводку».
  await go('/nowhere')
  check('незнакомый адрес ведёт на «Сводку»', (await run('location.hash')) === '#/')

  // ── «Настройки» шестерёнкой; своё название (Р-03).
  await act(`document.querySelector('a.gear[href="#/settings"]').click();`)
  await sleep(700)
  await act(`byText('button', 'Название').click();`)
  await sleep(300)
  await act(`
    set(document.querySelector('input[name=title]'), 'Моя неделя');
    byText('button', 'Сохранить').click();
  `)
  await sleep(500)
  check('своё название — в заголовке вкладки', (await run('document.title')) === 'Моя неделя')
  await go('/')
  const renamed = await screen()
  check('своё название — в шапке «Сводки»', has(renamed, 'Моя неделя'), renamed.split('\n')[0])

  // Своё название переживает перезапуск: лежит в settings устройства.
  await send('Page.reload')
  await sleep(2000)
  check('своё название после перезапуска', has(await screen(), 'Моя неделя'))

  await go('/settings')
  await act(`
    byText('button', 'Как было').click();
  `)
  await sleep(200)
  await act(`byText('button', 'Сохранить').click();`)
  await sleep(500)
  check('«Как было» возвращает имя по умолчанию', (await run('document.title')) === DEFAULT_TITLE)

  // ── Копия данных файлом.
  await act(`byText('button', 'Копия данных').click();`)
  await sleep(300)
  const copy = await screen()
  check('пустой базе копировать нечего — без тревоги', has(copy, 'копировать нечего'), line(copy, 'копировать'))
  await act(`byText('button', 'Сохранить в файл').click();`)
  await sleep(1000)
  check('копия сохранена', has(await screen(), 'Файл сохранён'))
  const saved = readdirSync(profile).filter((name) => /^totaluchet-\d{4}-\d{2}-\d{2}\.json$/.test(name))
  check('файл копии скачан', saved.length === 1, saved.join(', '))

  // ── «О приложении»: дата сборки, база открылась.
  await act(`byText('button', 'О приложении').click();`)
  await sleep(500)
  const about = await screen()
  check('«О приложении» — сборка и версия схемы', has(about, 'Сборка') && has(about, 'Версия схемы'))
  check('база открылась — строки хранилищ', has(about, 'Приложения семьи') && has(about, 'Увиденные срезы'))
  await act(`byText('button', 'Сообщить об ошибке').click();`)
  await sleep(500)
  check('отчёт об ошибке открылся на заглушке синхронизации (Р-09)', has(await screen(), 'Открыть на GitHub') || has(await screen(), 'Скопировать'))

  // ── Без сети — из кеша работника. Последним: дальше сети нет.
  const controlled = await waitFor('navigator.serviceWorker?.controller')
  await offline(true)
  await send('Page.navigate', { url: APP })
  await sleep(2000)
  const cached = await screen()
  check(
    'без сети приложение открывается из кеша',
    controlled && cached.trim().length > 0,
    `работник ${controlled ? 'управляет' : 'не управляет'} страницей`,
  )
  await offline(false)
}

// ─── Прогон ────────────────────────────────────────────────────────────────

let server
let browser
let profile

try {
  server = await startServer()
  profile = mkdtempSync(join(tmpdir(), 'smoke-'))
  browser = spawn(
    findBrowser(),
    [
      '--headless=new',
      `--remote-debugging-port=${DEBUG_PORT}`,
      // Пустой временный профиль: своей базы у прогона нет и быть не должно.
      `--user-data-dir=${profile}`,
      '--no-first-run',
      '--disable-gpu',
      'about:blank',
    ],
    { stdio: 'ignore' },
  )

  await connect(await pageSocket())
  await scenario(profile)
} catch (failure) {
  problems.push(failure instanceof Error ? failure.message : String(failure))
} finally {
  socket?.close()
  browser?.kill()
  await server?.close()
}

// Браузер отпускает профиль не мгновенно, и на Windows удаление сразу
// после kill падает с EPERM. Не удалось — останется во временных.
await sleep(500)
if (profile) {
  try {
    rmSync(profile, { recursive: true, force: true })
  } catch {
    // Уберётся с временными файлами.
  }
}

const failed = checks.filter((each) => !each.passed)

for (const each of checks) {
  console.log(`${each.passed ? '  ok' : 'НЕТ '} ${each.what}${each.seen ? ` — ${each.seen}` : ''}`)
}

if (problems.length > 0) {
  console.log('\nБраузер сообщил об ошибках:')
  for (const problem of problems) console.log(`  ${problem}`)
}

const bad = failed.length > 0 || problems.length > 0
console.log(
  bad
    ? `\nПрогон не прошёл: проверок ${checks.length}, не сошлось ${failed.length}, ошибок ${problems.length}`
    : `\nПрогон прошёл: ${checks.length} проверок, ошибок нет`,
)

process.exit(bad ? 1 : 0)
