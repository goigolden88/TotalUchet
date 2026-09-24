/// <reference types="vitest/config" />
import { defineConfig } from 'vite'
import { configDefaults } from 'vitest/config'
import { familyVite } from './src/shared/scripts/vite.ts'
import { DEFAULT_TITLE, DESCRIPTION } from './src/ui/title.ts'

// GitHub Pages отдаёт сайт проекта по /<имя репозитория>/:
// https://goigolden88.github.io/TotalUchet/. Переименуете репозиторий —
// правьте эту строку.
const BASE = '/TotalUchet/'

// Сборка, работник и манифест — фабрикой ядра (Р-02); своё — адрес, имя
// и описание. Имя под иконкой зашивается в манифест при установке
// и за своим названием из «Настроек» не следует (Р-03).
export default defineConfig({
  ...familyVite({ base: BASE, name: DEFAULT_TITLE, description: DESCRIPTION }),

  // Тесты ядра гоняет CI ядра; здесь — только свои.
  test: {
    exclude: [...configDefaults.exclude, 'src/shared/**'],
  },
})
