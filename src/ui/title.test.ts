import { describe, expect, it } from 'vitest'
import html from '../../index.html?raw'
import { DEFAULT_TITLE, DESCRIPTION, MAX_TITLE, titleOf, titleToSave } from './title.ts'

/** Исходники приложения текстом — без ядра, без тестов и без самого title.ts. */
const SOURCES = import.meta.glob<string>(
  ['/src/**/*.{ts,tsx}', '!/src/shared/**', '!/src/**/*.test.ts', '!/src/ui/title.ts'],
  { query: '?raw', import: 'default', eager: true },
)

describe('своё название (Р-03)', () => {
  it('нет своего — имя по умолчанию', () => {
    expect(titleOf(undefined)).toBe(DEFAULT_TITLE)
    expect(titleOf(null)).toBe(DEFAULT_TITLE)
    expect(titleOf('   ')).toBe(DEFAULT_TITLE)
    expect(titleOf(42)).toBe(DEFAULT_TITLE)
  })

  it('своё — без пробелов по краям и не длиннее предела', () => {
    expect(titleOf('  Моя неделя ')).toBe('Моя неделя')
    expect(titleOf('я'.repeat(MAX_TITLE + 5))).toHaveLength(MAX_TITLE)
  })

  it('пустое и имя по умолчанию не сохраняются — своего нет', () => {
    expect(titleToSave('')).toBeNull()
    expect(titleToSave('  ')).toBeNull()
    expect(titleToSave(` ${DEFAULT_TITLE} `)).toBeNull()
    expect(titleToSave(' Моя неделя ')).toBe('Моя неделя')
  })
})

describe('тест-сторож: название — из одного места', () => {
  it('в исходниках название не написано руками — только в title.ts', () => {
    // Сторож не пустой: glob нашёл исходники.
    expect(Object.keys(SOURCES)).toContain('/src/app/config.ts')
    const offenders = Object.entries(SOURCES)
      .filter(([, text]) => text.includes(DEFAULT_TITLE))
      .map(([path]) => path)
    expect(offenders).toEqual([])
  })

  it('index.html — то же имя и описание, что в title.ts', () => {
    expect(/<title>([^<]*)<\/title>/.exec(html)?.[1]).toBe(DEFAULT_TITLE)
    expect(/<meta name="description" content="([^"]*)"/.exec(html)?.[1]).toBe(DESCRIPTION)
  })
})
