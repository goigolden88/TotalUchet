import { describe, expect, it } from 'vitest'
import { helpSections } from './help.ts'
import helpSource from './help.ts?raw'
import screenSource from './Help.tsx?raw'
import { FAMILY_TAB, SUMMARY_TAB } from './tabs.ts'

/** Исходники приложения и ядра текстом — без тестов и без самой справки. */
const SOURCES = import.meta.glob<string>(['/src/**/*.{ts,tsx}', '!/src/**/*.test.ts', '!/src/screens/help.ts'], {
  query: '?raw',
  import: 'default',
  eager: true,
})

/**
 * Цифры, написанные в тексте руками: в строках, шаблонах (без вставок `${…}`)
 * и тексте разметки. Комментарии не в счёт.
 */
function typedNumbers(source: string): string[] {
  const code = source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
  return [...code.matchAll(/'[^'\n]*'|"[^"\n]*"|`[^`]*`|>[^<>{}]*</g)]
    .map((match) => match[0].replace(/\$\{[^}]*\}/g, ''))
    .filter((text) => /\d/.test(text))
}

const TITLE = 'Выдуманное название'

describe('справка', () => {
  it('сторож цифр ловит цифру в строке, шаблоне и разметке', () => {
    expect(typedNumbers("const a = 'за 7 дней'")).toHaveLength(1)
    expect(typedNumbers('const a = `до ${MAX} знаков, не больше 30`')).toHaveLength(1)
    expect(typedNumbers('<p>Раз в 2 недели</p>')).toHaveLength(1)
    expect(typedNumbers('const a = `до ${MAX} знаков` // Р-35')).toEqual([])
  })

  it('цифрами в тексте справки ничего не написано — числа из констант', () => {
    expect(typedNumbers(helpSource)).toEqual([])
    expect(typedNumbers(screenSource)).toEqual([])
  })

  it('по разделу на экран, о данных и «если что-то не так»; ключи разные', () => {
    const sections = helpSections(TITLE)
    expect(sections.map((section) => section.title)).toEqual([
      SUMMARY_TAB.name,
      FAMILY_TAB.name,
      'Связки',
      'Настройки',
      'Данные и синхронизация',
      'Если что-то не так',
    ])
    expect(new Set(sections.map((section) => section.id)).size).toBe(sections.length)
    for (const section of sections) expect(section.paragraphs.length).toBeGreaterThan(0)
  })

  it('своё название — из настройки, а не строкой', () => {
    const text = helpSections(TITLE).flatMap((section) => section.paragraphs).join('\n')
    expect(text).toContain(`«${TITLE}»`)
  })

  it('названия в кавычках — те же, что на экранах', () => {
    // Сторож не пустой: glob нашёл экраны.
    expect(Object.keys(SOURCES)).toContain('/src/screens/Settings.tsx')
    const code = Object.values(SOURCES).join('\n').toLowerCase()
    const names = helpSections(TITLE)
      .flatMap((section) => section.paragraphs)
      .flatMap((text) => [...text.matchAll(/«([^«»]+)»/g)].map((match) => match[1] ?? ''))
      .filter((name) => name !== TITLE)
    expect(names.length).toBeGreaterThan(0)
    expect(names.filter((name) => !code.includes(name.toLowerCase()))).toEqual([])
  })
})
