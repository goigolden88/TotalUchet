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
// Подставной GitHub и выдуманный срез «Полки» ядра — те же, что в тестах
// чтения (Р-01): ни настоящего репозитория, ни токена, ни среза.
import { fakeGitHub } from '../src/reading/fakeGitHub.ts'
import { addDays, addMonths, monthOf, today } from '../src/shared/core/dates.ts'
import { buildSummary, summaryFile, summaryPeriods } from '../src/shared/core/summary.ts'
import { shelfSummary } from '../src/shared/testing/shelf.ts'
import { CHOICES, findPeriod, screenPeriod } from '../src/view/periods.ts'
import { formatValue } from '../src/view/values.ts'

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

    if (message.method === 'Fetch.requestPaused') {
      void answerGitHub(message.params)
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
  // «Сохранить» на «Настройках» не одна: у токена — своя.
  const saveTitle = () =>
    document.querySelector('input[name=title]').closest('form').querySelector('button[type=submit]').click();
  const startsWith = (tag, prefix) =>
    [...document.querySelectorAll(tag)].find((el) => el.textContent.trim().startsWith(prefix));
  // Свёрнутый блок по заголовку: у «Сводки» и «Семьи» приложения — блоками Fold.
  const fold = (title) =>
    [...document.querySelectorAll('section.block')].find((el) => el.querySelector('.fold__btn')?.textContent === title);
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

// ─── Подставной GitHub ─────────────────────────────────────────────────────

/** Выдуманный токен: настоящий в прогон не попадает никогда (Р-01). */
const TOKEN = 'fake-read-token'

/** Выдуманные репозитории данных: срез есть, среза нет, опечатка — нет вовсе; второй срез — для связок. */
const SHELF = 'someone/shelf-data'
const BED = 'someone/bed-data'
const TYPO = 'someone/typo-data'
const POND = 'someone/pond-data'

const DAY = today()

/** Срез «Полки» на сегодня: по сеансу в каждом из четырёх отрезков. */
const SLICE = (() => {
  const at = `${DAY}T08:00:00.000Z`
  const sessions = [
    { id: 's1', updatedAt: at, date: DAY, bookId: 'b', minutes: 25 },
    { id: 's2', updatedAt: at, date: addDays(DAY, -7), bookId: 'b', minutes: 70 },
    { id: 's3', updatedAt: at, date: `${addMonths(monthOf(DAY), -1)}-03`, bookId: 'b', minutes: 130 },
  ]
  const books = [{ id: 'b', updatedAt: at, title: 'Книга', addedOn: null }]
  return buildSummary(shelfSummary({ sessions, books }, DAY), { sessions, books }, DAY)
})()

const FILE = summaryFile(SLICE)

/**
 * Выдуманный «Пруд» — второй срез для связок (Р-17…Р-20): «Выходы к пруду»
 * у всех отрезков, «Улов» — только у месяцев. Без улова — строка пропала
 * из среза целиком, как у переименованной группы.
 */
function pondFile(withFish) {
  const periods = summaryPeriods(DAY).map((period, index) => {
    const visits = { key: 'pond.visits', label: 'Выходы к пруду', value: { n: period.grain === 'week' ? 2 : 6, unit: 'count' }, basis: 'по записям прогулок' }
    const fish = { key: 'pond.fish', label: 'Улов', value: { n: 3, unit: 'count' }, basis: 'по записям улова' }
    const metrics = period.grain === 'month' && withFish ? [visits, fish] : [visits]
    return { ...period, through: index % 2 === 1 ? DAY : null, metrics }
  })
  const file = summaryFile(buildSummary({ periods, attention: [] }, {}, DAY))
  return { [file.path]: file.content, 'meta.json': '{"app":"pond","schemaVersion":1}\n' }
}

/** Репозиторий «Пруда» — файлы меняются по ходу прогона. */
const pond = { files: pondFile(true) }

const github = fakeGitHub({
  [SHELF]: { files: { [FILE.path]: FILE.content, 'meta.json': '{"app":"polka","schemaVersion":1}\n' } },
  [BED]: { files: { 'meta.json': '{"app":"bed","schemaVersion":1}\n' } },
  [POND]: pond,
})

/** Нет связи с GitHub — запросы обрываются, как без сети. */
let githubDown = false

const CORS = [
  { name: 'Access-Control-Allow-Origin', value: '*' },
  { name: 'Access-Control-Allow-Headers', value: 'Authorization, Accept, X-GitHub-Api-Version, Content-Type' },
  { name: 'Access-Control-Allow-Methods', value: 'GET, OPTIONS' },
]

/** Ответ на перехваченный запрос к api.github.com — подставным GitHub. */
async function answerGitHub({ requestId, request }) {
  if (githubDown) {
    await send('Fetch.failRequest', { requestId, errorReason: 'InternetDisconnected' })
    return
  }
  if (request.method === 'OPTIONS') {
    await send('Fetch.fulfillRequest', { requestId, responseCode: 204, responseHeaders: CORS })
    return
  }
  const response = await github.fetch(request.url, { headers: request.headers })
  const body = Buffer.from(await response.text()).toString('base64')
  await send('Fetch.fulfillRequest', {
    requestId,
    responseCode: response.status,
    responseHeaders: [...CORS, ...[...response.headers].map(([name, value]) => ({ name, value }))],
    body,
  })
}

/** Добавить приложение в «Семье» формой. */
async function addApp(name, repo, site) {
  await act(`byText('button', 'Добавить приложение').click();`)
  await sleep(300)
  await act(`
    set(document.querySelector('input[name=name]'), ${JSON.stringify(name)});
    set(document.querySelector('input[name=dataRepo]'), ${JSON.stringify(repo)});
    set(document.querySelector('input[name=site]'), ${JSON.stringify(site)});
  `)
  await sleep(100)
  await act(`byText('button', 'Сохранить').click();`)
  await sleep(500)
}

/** Что «Сводка» должна показать строкой «Чтение» на отрезке — теми же функциями показа. */
function expectedReading(choice) {
  const view = findPeriod(SLICE, screenPeriod(choice, DAY))
  if (!view.found) return view.text
  const metrics = view.period.metrics
  if ('unknown' in metrics) return formatValue(metrics).text
  return formatValue(metrics[0].value).text
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
  check('без токена — «не настроено» со ссылкой в «Настройки»', has(start, 'нет токена чтения'), line(start, 'токен'))
  check('заголовок вкладки — название', (await run('document.title')) === DEFAULT_TITLE)

  // ── «Семья» — вкладкой, по адресу.
  await act(`document.querySelector('nav.tabs a[href="#/family"]').click();`)
  await sleep(700)
  const family = await screen()
  check('«Семья» открылась вкладкой, приложений нет', has(family, 'Приложений пока нет'), line(family, 'приложени'))

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
    saveTitle();
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
  await act(`saveTitle();`)
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
  const report = await screen()
  check('отчёт об ошибке открылся без синхронизации (Я-29, Р-16)', has(report, 'Открыть на GitHub') || has(report, 'Скопировать'))
  check('в отчёте — «Синхронизация: выключена»', has(report, 'Синхронизация: выключена'))

  // ── Этап 1: срезы с подставного GitHub. Запросы к api.github.com
  // до сети не доходят — отвечает подставной.
  await send('Fetch.enable', { patterns: [{ urlPattern: 'https://api.github.com/*' }] })

  // «Семья»: три приложения — со срезом, без среза, с опечаткой в имени (Р-10).
  await go('/family')
  await addApp('Полка', `https://github.com/${SHELF}`, 'https://example.org/shelf')
  await addApp('Грядка', BED, 'https://example.org/bed/')
  await addApp('Опечатка', TYPO, 'https://example.org/typo/')
  await addApp('Пруд', POND, 'https://example.org/pond/')
  const listed = await screen()
  check('«Семья»: три приложения добавлены', has(listed, 'Полка') && has(listed, 'Грядка') && has(listed, 'Опечатка'))
  check('«Семья»: ссылка на репозиторий сведена к «владелец/имя»', has(listed, SHELF) && !has(listed, `github.com/${SHELF}`))
  check('«Семья»: у сайта слеш в конце', has(listed, 'https://example.org/shelf/'))
  check('«Семья» без токена — «не настроено» со ссылкой в «Настройки»', has(listed, 'нет токена чтения'), line(listed, 'токен'))

  // Поправить: форма — в блоке приложения; имя меняется, запись та же.
  await act(`[...fold('Опечатка').querySelectorAll('button')].find((el) => el.textContent === 'Поправить').click();`)
  await sleep(300)
  check('«Семья»: форма правки — в блоке приложения', (await act(`return Boolean(fold('Опечатка')?.querySelector('input[name=name]'));`)) === true)
  await act(`set(document.querySelector('input[name=name]'), 'Опечатка в имени');`)
  await sleep(100)
  await act(`byText('button', 'Сохранить').click();`)
  await sleep(500)
  check('«Семья»: приложение поправлено', has(await screen(), 'Опечатка в имени'))

  // «Настройки»: токен и проверка доступа.
  await go('/settings')
  const tokenOpen = await screen()
  check('без токена его раздел в «Настройках» открыт', has(tokenOpen, 'Fine-grained'), line(tokenOpen, 'токен'))
  await act(`set(document.querySelector('input[name=token]'), ${JSON.stringify(TOKEN)});`)
  await sleep(100)
  await act(`[...document.querySelectorAll('form')].find((form) => form.querySelector('input[name=token]')).querySelector('button[type=submit]').click();`)
  await sleep(500)
  const tokenSaved = await screen()
  check('токен вписан, на экране его нет', has(tokenSaved, 'Токен вписан') && !has(tokenSaved, TOKEN))
  await act(`byText('button', 'Проверить доступ').click();`)
  await waitFor(`document.querySelector('.access')`)
  const access = await screen()
  check('проверка доступа: полное имя репозитория', has(access, `видит ${SHELF}`), line(access, SHELF))
  check('проверка доступа: права токена не выдумываются (Р-12)', has(access, 'права токена GitHub не сообщает'))
  check('проверка доступа: опечатка — «токен не видит репозиторий»', has(access, `токен не видит репозиторий ${TYPO}`), line(access, TYPO))

  // «Сводка» читает срезы.
  await go('/')
  await waitFor(`document.querySelector('.refresh button') && !document.querySelector('.refresh button').disabled && document.body.innerText.includes('посчитано')`)
  const summary = await screen()
  check('«Сводка»: свежесть — «посчитано · по записям по»', has(summary, 'посчитано') && has(summary, 'по записям по'), line(summary, 'посчитано'))
  check('«Сводка»: строка с основанием', has(summary, 'Чтение') && has(summary, 'по 1 сеансам'), line(summary, 'сеанс'))
  check('«Сводка»: идущая неделя — «идёт, по»', has(summary, 'идёт, по'), line(summary, 'идёт'))
  check('«Сводка»: «Зовут» — пункт со ссылкой', has(summary, 'Зовут') && has(summary, 'Книги без даты') && has(summary, 'открыть'), line(summary, 'Книги'))
  check('«Сводка»: приложение без summary.json — «срез не отдаёт»', has(summary, 'срез не отдаёт'), line(summary, 'срез не'))
  check('«Сводка»: опечатка — «токен не видит репозиторий»', has(summary, `токен не видит репозиторий ${TYPO}`), line(summary, 'токен не видит'))
  check('«Сводка»: токен в экран не попал', !has(summary, TOKEN))
  check('«Сводка»: нет ложного «токен шире, чем чтение» (Р-12)', !has(summary, 'шире'))
  const href = await run(`document.querySelector('.call a')?.getAttribute('href')`)
  check('«открыть» — сайт приложения и путь хеш-роутинга', href === 'https://example.org/shelf/#/books', String(href))

  // Все четыре отрезка переключаются; число — отрезка экрана, найденного по концам.
  for (const choice of CHOICES) {
    await act(`byText('button', ${JSON.stringify(choice.label)}).click();`)
    await sleep(200)
    const shown = await run(`[...document.querySelectorAll('section.block')].find((el) => el.querySelector('.fold__btn')?.textContent === 'Полка')?.innerText ?? ''`)
    const want = expectedReading(choice.id)
    check(`отрезок «${choice.label}» — ${want}`, has(shown, want), shown.replace(/\s+/g, ' ').slice(0, 120))
  }

  // Блок приложения и «Зовут» сворачиваются; у свёрнутого — итог рядом с заголовком.
  await act(`byText('button', 'Полка').click(); byText('button', 'Зовут').click();`)
  await sleep(300)
  const folded = await screen()
  check('блок приложения свёрнут — у заголовка «посчитано»', !has(folded, 'Чтение') && has(folded, '· посчитано'), line(folded, 'Полка'))
  const namedCaller = /Зовут\s*·\s*Полка/i.test(folded.replace(/ /g, ' '))
  check('«Зовут» свёрнуто — у заголовка кто зовёт', !has(folded, 'Книги без даты') && namedCaller, line(folded, 'Зовут'))
  await act(`byText('button', 'Полка').click(); byText('button', 'Зовут').click();`)
  await sleep(300)

  // «Семья»: состояние среза у каждого — теми же словами, что на «Сводке» (Р-13).
  await go('/family')
  await waitFor(`document.body.innerText.includes('токен не видит') && document.body.innerText.includes('посчитано')`)
  const states = await screen()
  check('«Семья»: у прочитанного — «посчитано · по записям по»', has(states, 'по записям по'), line(states, 'по записям'))
  check('«Семья»: без summary.json — «срез не отдаёт»', has(states, 'срез не отдаёт'), line(states, 'срез не'))
  check('«Семья»: опечатка — «токен не видит репозиторий»', has(states, `токен не видит репозиторий ${TYPO}`), line(states, 'токен не видит'))
  check('«Семья»: токен в экран не попал', !has(states, TOKEN))

  // Свёрнутые блоки приложений: у заголовка — итог.
  await act(`byText('button', 'Полка').click(); byText('button', 'Грядка').click(); byText('button', 'Опечатка в имени').click();`)
  await sleep(300)
  const briefs = (await screen()).replace(/ /g, ' ')
  check('«Семья»: свёрнуто — у прочитанного «посчитано»', /Полка\s*·\s*посчитано/i.test(briefs) && !has(briefs, SHELF), line(briefs, 'Полка'))
  check('«Семья»: свёрнуто — «срез не отдаёт»', /Грядка\s*·\s*срез не отдаёт/i.test(briefs), line(briefs, 'Грядка'))
  check('«Семья»: свёрнуто — опечатка «не прочитан»', /Опечатка в имени\s*·\s*не прочитан/i.test(briefs), line(briefs, 'Опечатка'))

  // «Как установить»: свёрнут, внутри — ссылка на сайт каждого (Р-07, Р-13).
  check('«Как установить» свёрнут, итог у заголовка', has(briefs, 'каждое — со своего сайта') && !has(briefs, 'открыть сайт'), line(briefs, 'установить'))
  await act(`byText('button', 'Как установить').click();`)
  await sleep(300)
  const sites = await act(`return [...fold('Как установить').querySelectorAll('a')].map((a) => a.getAttribute('href') + ' ' + a.target).join('|');`)
  check(
    '«Как установить»: ссылка на сайт каждого, новой вкладкой',
    sites === 'https://example.org/shelf/ _blank|https://example.org/bed/ _blank|https://example.org/typo/ _blank|https://example.org/pond/ _blank',
    String(sites),
  )
  await act(`byText('button', 'Полка').click(); byText('button', 'Грядка').click(); byText('button', 'Опечатка в имени').click(); byText('button', 'Как установить').click();`)
  await sleep(300)
  await go('/')
  await waitFor(`!document.querySelector('.refresh button').disabled`)

  await bundles()

  // Без связи с GitHub — последний увиденный с датой прочтения.
  githubDown = true
  await act(`byText('button', 'Обновить').click();`)
  await sleep(300)
  await waitFor(`!document.querySelector('.refresh button').disabled`)
  const cut = await screen()
  check('без связи — «прочитан …, сейчас нет связи» и срез на месте', has(cut, 'сейчас нет связи') && has(cut, 'Чтение'), line(cut, 'нет связи'))
  githubDown = false
  await send('Fetch.disable')

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

/** Отметить строку в форме связки — по подписи. */
function pick(label) {
  return `[...document.querySelectorAll('label.check')].find((el) => el.innerText.startsWith(${JSON.stringify(label)})).querySelector('input').click();`
}

/**
 * Связки (Р-17…Р-21): завести в «Семье», увидеть на «Сводке» между
 * переключателем и приложениями, строку, которой нет в отрезке и нет
 * в срезе вовсе, путь «поправь связку», убранное приложение.
 */
async function bundles() {
  await go('/family')
  await waitFor(`document.body.innerText.includes('Новая связка')`)
  check('«Семья»: «Связки» — пока нет', /Связки\s*·\s*нет/i.test((await screen()).replace(/ /g, ' ')))

  await act(`byText('button', 'Новая связка').click();`)
  await sleep(300)
  await act(`set(document.querySelector('input[name=bundleName]'), 'Рядом');`)
  await act(pick('Чтение'))
  await act(pick('Выходы к пруду'))
  await act(pick('Улов'))
  await sleep(100)
  await act(`byText('button', 'Сохранить').click();`)
  await sleep(500)
  check('«Семья»: связка заведена', has(await screen(), 'Связка «Рядом» заведена'))

  await act(`byText('button', 'Новая связка').click();`)
  await sleep(300)
  const taken = await act(`
    const box = [...document.querySelectorAll('label.check')].find((el) => el.innerText.startsWith('Чтение'));
    return box.querySelector('input').disabled + ' ' + box.innerText;
  `)
  check('форма: строка из другой связки недоступна (Р-17)', /^true .*в связке «Рядом»/.test(String(taken).replace(/ /g, ' ')), String(taken))
  await act(`byText('button', 'Отмена').click();`)
  await sleep(300)

  // «Сводка»: связка — между переключателем и приложениями (Р-19).
  await go('/')
  await waitFor(`document.body.innerText.includes('Выходы к пруду')`)
  const order = await act(`
    const blocks = [...document.querySelectorAll('#root .switch, #root section.block')];
    const at = (title) => blocks.findIndex((el) => el.querySelector?.('.fold__btn')?.textContent === title);
    return [blocks.findIndex((el) => el.classList.contains('switch')), at('Рядом'), at('Полка')].join(' ');
  `)
  const [switchAt, bundleAt, shelfAt] = String(order).split(' ').map(Number)
  check('«Сводка»: связка — после переключателя, до приложений', switchAt < bundleAt && bundleAt < shelfAt, String(order))

  await act(`byText('button', 'Эта неделя').click();`)
  await sleep(200)
  const week = await act(`return fold('Рядом').innerText;`)
  check('связка: оба приложения, у каждого своя свежесть', has(week, 'Полка') && has(week, 'Пруд') && (week.match(/посчитано/g) ?? []).length === 2, week.replace(/\s+/g, ' ').slice(0, 160))
  check('связка: строки хозяев с основанием', has(week, 'Чтение') && has(week, 'Выходы к пруду') && has(week, 'по записям прогулок'))
  check('связка: «Улов» на неделе — «нет в срезе за этот отрезок» (Р-20)', has(week, 'Улов — нет в срезе за этот отрезок'), line(week, 'Улов'))

  await act(`byText('button', 'Этот месяц').click();`)
  await sleep(200)
  const month = await act(`return fold('Рядом').innerText;`)
  check('связка: на месяце — «Улов» с основанием', has(month, 'по записям улова') && !has(month, 'нет в срезе'), line(month, 'Улов'))

  await act(`byText('button', 'Рядом').click();`)
  await sleep(300)
  const brief = (await screen()).replace(/ /g, ' ')
  check('связка свёрнута — у заголовка имена приложений, без чисел', /Рядом\s*·\s*Полка · Пруд/i.test(brief), line(brief, 'Рядом'))
  await act(`byText('button', 'Рядом').click();`)
  await sleep(300)

  // Строка пропала из среза целиком — «поправь связку» ведёт в «Семью» (Р-20, Р-21).
  pond.files = pondFile(false)
  await act(`byText('button', 'Обновить').click();`)
  await sleep(300)
  await waitFor(`!document.querySelector('.refresh button').disabled && document.body.innerText.includes('ни в одном отрезке')`)
  const gone = await act(`return fold('Рядом').innerText;`)
  check('связка: строки нет ни в одном отрезке — сказано и «поправь связку»', has(gone, 'этой строки нет ни в одном отрезке') && has(gone, 'поправь связку'), line(gone, 'ни в одном'))
  const fix = await run(`[...document.querySelectorAll('a')].find((a) => a.textContent === 'поправь связку')?.getAttribute('href') ?? ''`)
  check('«поправь связку» — на связку в «Семье»', /^#\/family\?bundle=/.test(String(fix)), String(fix))
  await act(`[...document.querySelectorAll('a')].find((a) => a.textContent === 'поправь связку').click();`)
  await waitFor(`document.querySelector('input[name=bundleName]')`)
  const form = await screen()
  check('«Семья»: пришли ссылкой — форма связки открыта', (await run(`document.querySelector('input[name=bundleName]').value`)) === 'Рядом')
  check('форма: пропавшая строка помечена', has(form, 'нет в последнем срезе'), line(form, 'нет в последнем'))
  await act(`byText('button', 'Отмена').click();`)
  await sleep(300)

  // Приложение убрано: на «Сводке» его строк нет, в форме — «приложение убрано» (Р-20).
  await act(`window.confirm = () => true; [...fold('Пруд').querySelectorAll('button')].find((el) => el.textContent === 'Убрать').click();`)
  await sleep(500)
  await act(`[...fold('Рядом').querySelectorAll('button')].find((el) => el.textContent === 'Поправить').click();`)
  await sleep(300)
  const removed = await screen()
  check('форма: строки убранного приложения — отдельно, с пометкой', has(removed, 'Убранные из') && has(removed, 'приложение убрано'), line(removed, 'убран'))
  await act(`byText('button', 'Отмена').click();`)
  await sleep(300)
  await go('/')
  await waitFor(`!document.querySelector('.refresh button').disabled`)
  const after = await act(`return fold('Рядом').innerText;`)
  check('«Сводка»: у убранного приложения в связке строк нет', has(after, 'Чтение') && !has(after, 'Пруд') && !has(after, 'Выходы'), after.replace(/\s+/g, ' ').slice(0, 120))
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
