/**
 * Имена репозиториев данных — соседям из списка (Р-34, Я-37 ядра).
 *
 * Имя репозитория данных каждое приложение семьи берёт из общей базы
 * устройства — по своему `dbName` (Я-35). Какой `dbName` у приложения
 * из «Семьи», говорит поле `app` его `meta.json` (Я-24): его узнаёт проход
 * чтения, и держится оно только в памяти — в записи `App` поля нет.
 *
 * Пустые места заполняются сами после прохода (`fillRepos` ядра); занятое
 * переписывает только человек — кнопкой в «Семье» (`family.setRepo`).
 * Своё место не трогается: его ведёт «Синхронизация».
 */

import type { App } from '../app/model.ts'
import { family } from '../shared/core/db.ts'
import { parseRepo } from '../shared/core/github.ts'

/**
 * Что раздать: `dbName` → репозиторий из списка. `dbName` не узнан — мимо;
 * своё — мимо; два приложения списка с одним `dbName` — первое по порядку.
 */
export function repoNames(
  apps: readonly Pick<App, 'id' | 'dataRepo'>[],
  dbNames: ReadonlyMap<string, string | null | undefined>,
  own: string,
): Record<string, string> {
  const names: Record<string, string> = {}
  for (const app of apps) {
    const dbName = dbNames.get(app.id)
    if (!dbName || dbName === own || dbName in names) continue
    names[dbName] = app.dataRepo
  }
  return names
}

/** Вписать имена из списка в пустые места общей базы. Отдаёт, каким `dbName` записано. */
export async function shareRepos(
  apps: readonly Pick<App, 'id' | 'dataRepo'>[],
  dbNames: ReadonlyMap<string, string | null | undefined>,
  own: string,
): Promise<string[]> {
  const names = repoNames(apps, dbNames, own)
  if (Object.keys(names).length === 0) return []
  return family.fillRepos(names)
}

/** Тот же ли репозиторий: GitHub не различает регистр, вписать могли и ссылкой. */
export function sameRepo(a: string, b: string): boolean {
  return key(a) === key(b)
}

function key(repo: string): string {
  try {
    const { owner, name } = parseRepo(repo)
    return `${owner}/${name}`.toLowerCase()
  } catch {
    return repo.trim().toLowerCase()
  }
}

export type RepoStatus =
  /** Проход чтения ещё не узнал `dbName`: сказать нечего. */
  | { kind: 'unread' }
  /** В репозитории приложения нет `meta.json` или поля `app`. */
  | { kind: 'unknown' }
  /** Это место самого «Тотального Учёта». */
  | { kind: 'own' }
  | { kind: 'same' }
  | { kind: 'empty' }
  /** На устройстве вписано другое имя — `repo`. */
  | { kind: 'other'; repo: string }

/** Имя приложения в общей базе устройства против имени в списке (Р-34). */
export function repoStatus(
  dbName: string | null | undefined,
  dataRepo: string,
  repos: Readonly<Record<string, string>>,
  own: string,
): RepoStatus {
  if (dbName === undefined) return { kind: 'unread' }
  if (dbName === null) return { kind: 'unknown' }
  if (dbName === own) return { kind: 'own' }
  const repo = repos[dbName]
  if (repo === undefined) return { kind: 'empty' }
  return sameRepo(repo, dataRepo) ? { kind: 'same' } : { kind: 'other', repo }
}

/** Слова для «Семьи». `unread` — пусто: строки нет. */
export function repoStatusText(status: RepoStatus, title: string): string {
  switch (status.kind) {
    case 'unread':
      return ''
    case 'unknown':
      return 'не знаю, какое это приложение: в его репозитории нет meta.json'
    case 'own':
      return `это сам «${title}»: его имя вписывается в «Настройки» → «Синхронизация»`
    case 'same':
      return 'имя на устройстве: совпадает'
    case 'empty':
      return 'имя на устройстве: пусто — впишется при чтении'
    case 'other':
      return `имя на устройстве другое: ${status.repo}`
  }
}
