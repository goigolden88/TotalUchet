/**
 * Название приложения — одно место на весь код (Р-03).
 *
 * Шапка, заголовок вкладки браузера и тексты, называющие приложение, берут
 * имя отсюда: `settings.title` устройства или имя по умолчанию. Написать
 * название в исходнике руками не даёт тест-сторож (`title.test.ts`).
 *
 * Без базы и React: файл читает и `vite.config.ts` — имя в манифесте.
 * Чтение и запись настройки — `useTitle.ts`.
 */

/** Имя по умолчанию и в манифесте. В тексте не склоняется: «приложение «Тотальный Учёт»». */
export const DEFAULT_TITLE = 'Тотальный Учёт'

/** Описание в манифесте и в `index.html`. */
export const DESCRIPTION = 'Неделя и месяц приложений семьи на одном экране. Работает без сети.'

/** Ключ своего названия в `settings` устройства. */
export const TITLE_KEY = 'title'

/** Длиннее шапка на телефоне не помещается в строку. */
export const MAX_TITLE = 40

/** Что показать по сохранённому: пустое, пробелы и не строка — имя по умолчанию. */
export function titleOf(saved: unknown): string {
  if (typeof saved !== 'string') return DEFAULT_TITLE
  const clean = saved.trim()
  return clean === '' ? DEFAULT_TITLE : clean.slice(0, MAX_TITLE)
}

/** Что сохранить из поля ввода: имя по умолчанию и пустое — null, то есть «своего нет». */
export function titleToSave(input: string): string | null {
  const clean = input.trim().slice(0, MAX_TITLE)
  return clean === '' || clean === DEFAULT_TITLE ? null : clean
}
