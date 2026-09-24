/**
 * Чтение среза одного приложения (Р-05) — без React и без базы.
 *
 * Источник истины — docs/02-Архитектура.md, «Чтение среза». Порядок:
 * доступ к репозиторию, голова ветки по умолчанию, дерево, запись
 * `summary.json`, сверка отпечатка, файл, `parseSummary` ядра.
 *
 * Доступ проверяется до файла: приватный репозиторий без доступа GitHub
 * отдаёт тем же 404, что и несуществующий, и «нет доступа» иначе выглядело
 * бы как «срез не отдаёт». Тексты ошибок клиента ядра написаны для пишущего
 * («нужен Read and write», «отправка отложена»), поэтому здесь — свои,
 * по коду ответа.
 *
 * Читается только `SUMMARY_PATH` ядра (Я-11, Я-16). Токен приходит
 * параметром и никуда, кроме заголовка запроса, не попадает.
 */

import { createClient, GitHubError, parseRepo } from '../shared/core/github.ts'
import { parseSummary, SUMMARY_PATH, type Summary } from '../shared/core/summary.ts'

/** Почему не прочиталось — у каждой причины своё действие человека (Р-05). */
export type Failure = 'badRepo' | 'noAccess' | 'badToken' | 'noRights' | 'limit' | 'offline' | 'other'

export type ReadResult =
  /** Новый срез: его — в архив. */
  | { kind: 'new'; sha: string; summary: Summary; canWrite: boolean }
  /** Отпечаток тот же, что у последнего увиденного: файл не качали. */
  | { kind: 'same'; canWrite: boolean }
  /** `summary.json` нет — дело приложения, не ошибка (Я-16). */
  | { kind: 'none'; text: string; canWrite: boolean }
  /** Файл есть, но с формой не сходится: словами ядра. */
  | { kind: 'broken'; text: string; canWrite: boolean }
  | { kind: 'failed'; failure: Failure; text: string }

export type ReadOptions = {
  /** Репозиторий данных «владелец/имя» — из записи человека. */
  dataRepo: string
  token: string
  /** Отпечаток последнего увиденного среза; `null` — не видели. */
  lastSha: string | null
  /** Подменяется в тестах. */
  fetch?: typeof globalThis.fetch
}

export const NOT_GIVEN = 'срез не отдаёт'

/** Тексты причин. Имя репозитория — в тексте: его вписал человек, и сверять — с ним. */
export function failureText(failure: Exclude<Failure, 'other'>, dataRepo: string): string {
  switch (failure) {
    case 'badRepo':
      return `не разобрал имя репозитория «${dataRepo}»: нужно «владелец/имя»`
    case 'noAccess':
      return `токен не видит репозиторий ${dataRepo}: опечатка в имени или токен выдан не на него`
    case 'badToken':
      return 'токен не принят: истёк срок, его отозвали или вписали не целиком'
    case 'noRights':
      return `токен видит репозиторий ${dataRepo}, но не читает файлы: нужен доступ Contents: Read-only`
    case 'limit':
      return 'GitHub временно отказывает: исчерпан лимит запросов, попробуй позже'
    case 'offline':
      return 'нет связи'
  }
}

function failed(failure: Failure, dataRepo: string, text?: string): ReadResult {
  return { kind: 'failed', failure, text: text ?? (failure === 'other' ? '' : failureText(failure, dataRepo)) }
}

/**
 * Ошибка → причина. `onInfo` — ошибка на проверке доступа: там 404 значит
 * «не видит», а после неё 404 — уже странность, а не опечатка.
 */
function explain(error: unknown, dataRepo: string, offline: boolean, onInfo: boolean): ReadResult {
  // Обрыв связи ловится на самом fetch: статус 0 у клиента ядра бывает
  // и у ошибок без сервера — «дерево не поместилось», чужая кодировка.
  if (offline) return failed('offline', dataRepo)
  if (!(error instanceof GitHubError)) {
    return failed('other', dataRepo, error instanceof Error ? error.message : 'неизвестная ошибка')
  }
  if (error.status === 401) return failed('badToken', dataRepo)
  if (error.status === 403) return failed(error.badToken ? 'noRights' : 'limit', dataRepo)
  if (error.status === 404 && onInfo) return failed('noAccess', dataRepo)
  if (error.status === 404) return failed('other', dataRepo, 'GitHub не нашёл файл, который сам назвал в дереве')
  return failed('other', dataRepo, error.message)
}

/** Прочитать срез одного приложения. Не кидает: всё, что пошло не так, — в итоге словами. */
export async function readSummary({ dataRepo, token, lastSha, fetch = globalThis.fetch }: ReadOptions): Promise<ReadResult> {
  let repo: { owner: string; name: string }
  try {
    repo = parseRepo(dataRepo)
  } catch {
    return failed('badRepo', dataRepo)
  }

  let offline = false
  const guarded: typeof globalThis.fetch = async (input, init) => {
    try {
      return await fetch(input, init)
    } catch (error) {
      offline = true
      throw error
    }
  }

  let canWrite = false
  let branch = ''
  try {
    const info = await createClient({ repo: { ...repo, branch: '' }, token, fetch: guarded }).info()
    canWrite = info.canWrite
    branch = info.defaultBranch
  } catch (error) {
    return explain(error, dataRepo, offline, true)
  }

  try {
    const client = createClient({ repo: { ...repo, branch }, token, fetch: guarded })
    const head = await client.head()
    // Пустой репозиторий: ни одного коммита — и среза нет.
    if (head === null) return { kind: 'none', text: NOT_GIVEN, canWrite }
    const entry = (await client.tree(head)).find((file) => file.path === SUMMARY_PATH)
    if (!entry) return { kind: 'none', text: NOT_GIVEN, canWrite }
    if (entry.sha === lastSha) return { kind: 'same', canWrite }
    const text = await client.blob(entry.sha)
    try {
      return { kind: 'new', sha: entry.sha, summary: parseSummary(text), canWrite }
    } catch (error) {
      return { kind: 'broken', text: error instanceof Error ? error.message : 'срез не разобран', canWrite }
    }
  } catch (error) {
    return explain(error, dataRepo, offline, false)
  }
}
