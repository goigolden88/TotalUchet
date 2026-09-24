/**
 * Иконки PWA «Тотального Учёта» из геометрии public/favicon.svg.
 *
 * Растеризатор и PNG — ядра (`shared/scripts/icons.mjs`); здесь — свой
 * рисунок. Запускается руками (`npm run icons`), результат коммитится.
 *
 * Рисунок: четыре квадрата в цветах иконок соседей — вся семья на одном
 * экране, — и в середине кружок акцента метаприложения, который их
 * связывает. Цвета соседей — их акценты на 24.09.2026; поменяют свои —
 * здесь не обязательно менять: это рисунок, а не список приложений.
 */

import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { BACKGROUND, writeIcons } from '../src/shared/scripts/icons.mjs'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public')

/** Бирюзовый — свободен у семьи; тот же, что `--accent` тёмной темы. */
const ACCENT = [0x5c, 0xc8, 0xbf]

const WARM = [0xf2, 0xb3, 0x5b]
const GREEN = [0x7c, 0xcf, 0x8a]
const BLUE = [0x6f, 0x9d, 0xff]
const VIOLET = [0xc0, 0x7a, 0xe8]

/**
 * Те же фигуры, что в favicon.svg. Расходиться им нельзя.
 *
 * Квадраты 120 со щелью 24: углы — в 187 от центра, внутри безопасной зоны
 * maskable (круг радиусом 204.8). Кружок — на подложке цвета фона, чтобы
 * отделиться от квадратов.
 */
const SHAPES = [
  { x: 124, y: 124, w: 120, h: 120, r: 28, color: WARM, alpha: 1 },
  { x: 268, y: 124, w: 120, h: 120, r: 28, color: GREEN, alpha: 1 },
  { x: 124, y: 268, w: 120, h: 120, r: 28, color: BLUE, alpha: 1 },
  { x: 268, y: 268, w: 120, h: 120, r: 28, color: VIOLET, alpha: 1 },
  // Подложка и кружок в середине
  { x: 198, y: 198, w: 116, h: 116, r: 58, color: BACKGROUND, alpha: 1 },
  { x: 220, y: 220, w: 72, h: 72, r: 36, color: ACCENT, alpha: 1 },
]

writeIcons({ out: OUT, shapes: SHAPES })
