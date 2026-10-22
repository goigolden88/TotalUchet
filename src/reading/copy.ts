/**
 * «Копия всей семьи» (Р-36) — без React и без базы.
 *
 * Один файл со всеми файлами репозиториев данных из «Семьи» и своего
 * репозитория данных «Учёта» (Р-37), токеном «семья»: запасной путь на случай
 * потери аккаунта GitHub. Путь тот же, что у чтения
 * среза (`read.ts`): доступ, голова ветки по умолчанию, дерево — и все его
 * файлы. Причины — теми же словами. Файлы берутся текстом как есть, не
 * разбираются: моделей приложений метаприложение не знает (Я-11).
 *
 * Только GET клиента ядра: в репозитории приложений ничего не пишется.
 * Токен приходит параметром и никуда, кроме заголовка запроса, не попадает.
 */

import type { App } from '../app/model.ts'
import { plural, type DateStr } from '../shared/core/dates.ts'
import { createClient, parseRepo, type TreeEntry } from '../shared/core/github.ts'
import { explain, failureText, guard } from './read.ts'
import { sameRepo } from './repos.ts'

/** Версия формы файла. Растёт, если форма меняется. */
export const COPY_FORMAT = 1

/** Сколько файлов одного репозитория качается разом. */
const PARALLEL = 4

export type CopiedFile = {
  /** Путь в репозитории данных — тот же, куда класть при восстановлении. */
  path: string
  /** Содержимое как есть. */
  text: string
}

/** Приложение в копии: его файлы или причина, почему их нет. */
export type AppCopy = { name: string; dataRepo: string } & (
  | {
      /** Отпечаток коммита, с которого снята копия; `null` — в репозитории ни одного коммита. */
      commit: string | null
      files: CopiedFile[]
    }
  | { failed: string }
)

export type FamilyCopy = {
  format: typeof COPY_FORMAT
  /** День, когда снята копия. */
  takenOn: DateStr
  apps: AppCopy[]
}

/**
 * Свой репозиторий данных «Учёта» (Р-37): имя — своё название (Р-03),
 * репозиторий — из общей базы устройства по своему `dbName`. Не вписан или
 * база не открылась — причина: в файле он с ней, как нечитаемое приложение.
 */
export type OwnRepo = Pick<App, 'name' | 'dataRepo'> | { name: string; failed: string }

/** Причина, когда своё имя репозитория данных не вписано. */
export const OWN_NOT_SET = 'репозиторий данных не вписан: «Настройки» → «Синхронизация»'
/** Причина, когда общая база устройства не открылась. */
export const OWN_UNKNOWN = 'общая база устройства не открылась: имя репозитория данных не узнать'

/** Свой репозиторий из имён общей базы; `null` — база не открылась. */
export function ownRepo(name: string, repos: Readonly<Record<string, string>> | null, dbName: string): OwnRepo {
  if (repos === null) return { name, failed: OWN_UNKNOWN }
  const dataRepo = repos[dbName]?.trim()
  return dataRepo ? { name, dataRepo } : { name, failed: OWN_NOT_SET }
}

export type CopyOptions = {
  apps: readonly Pick<App, 'name' | 'dataRepo'>[]
  /** Свой репозиторий — последним; уже есть в `apps` — второй раз не входит. */
  own: OwnRepo
  token: string
  day: DateStr
  /** Подменяется в тестах. */
  fetch?: typeof globalThis.fetch
}

/** Имя файла копии: `family-ГГГГ-ММ-ДД.json`. */
export function copyFileName(day: DateStr): string {
  return `family-${day}.json`
}

/** Прочитался ли хоть один репозиторий: нет — файл не скачивается. */
export function anyCopied(copy: FamilyCopy): boolean {
  return copy.apps.some((app) => !('failed' in app))
}

/** Строка приложения на экране: «в копии: N файлов» или «не прочитано: причина». */
export function copyLine(app: AppCopy): string {
  if ('failed' in app) return `не прочитано: ${app.failed}`
  const count = app.files.length
  return `в копии: ${count} ${plural(count, ['файл', 'файла', 'файлов'])}`
}

/**
 * Собрать копию всех приложений и своего репозитория. Не кидает: нечитаемое
 * приложение — в копии с причиной. Своё имя не узнано — запись с причиной
 * и пустым `dataRepo`: форма файла та же.
 */
export async function copyFamily({ apps, own, token, day, fetch = globalThis.fetch }: CopyOptions): Promise<FamilyCopy> {
  const extra = 'failed' in own || apps.some((app) => sameRepo(app.dataRepo, own.dataRepo)) ? [] : [own]
  const copies = await Promise.all([...apps, ...extra].map((app) => copyApp(app, token, fetch)))
  if ('failed' in own) copies.push({ name: own.name, dataRepo: '', failed: own.failed })
  return { format: COPY_FORMAT, takenOn: day, apps: copies }
}

async function copyApp({ name, dataRepo }: Pick<App, 'name' | 'dataRepo'>, token: string, fetch: typeof globalThis.fetch): Promise<AppCopy> {
  let repo: { owner: string; name: string }
  try {
    repo = parseRepo(dataRepo)
  } catch {
    return { name, dataRepo, failed: failureText('badRepo', dataRepo) }
  }

  const net = guard(fetch)
  const failed = (error: unknown, onInfo: boolean): AppCopy => {
    const result = explain(error, dataRepo, net.offline(), onInfo)
    return { name, dataRepo, failed: result.kind === 'failed' ? result.text : 'не прочитано' }
  }

  let branch = ''
  try {
    const info = await createClient({ repo: { ...repo, branch: '' }, token, fetch: net.fetch }).info()
    branch = info.defaultBranch
  } catch (error) {
    return failed(error, true)
  }

  try {
    const client = createClient({ repo: { ...repo, branch }, token, fetch: net.fetch })
    const head = await client.head()
    if (head === null) return { name, dataRepo, commit: null, files: [] }
    const tree = await client.tree(head)
    const files = await eachLimited(tree, async (entry: TreeEntry) => ({ path: entry.path, text: await client.blob(entry.sha) }))
    return { name, dataRepo, commit: head, files }
  } catch (error) {
    return failed(error, false)
  }
}

/** По `PARALLEL` разом, порядок итогов — порядок дерева. Первая ошибка — ошибка всего. */
async function eachLimited<T, R>(items: readonly T[], each: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = []
  let next = 0
  async function worker(): Promise<void> {
    while (next < items.length) {
      const index = next++
      results[index] = await each(items[index] as T)
    }
  }
  await Promise.all(Array.from({ length: Math.min(PARALLEL, items.length) }, worker))
  return results
}
