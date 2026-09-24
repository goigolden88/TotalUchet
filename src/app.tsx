import { HashRouter, Navigate, Route, Routes } from 'react-router-dom'
import { config } from './app/config.ts'
import { db, noSync } from './app/core.ts'
import { CoreProvider } from './shared/ui/core.tsx'
import { Layout } from './shared/ui/Layout.tsx'
import { Family } from './screens/Family.tsx'
import { Settings } from './screens/Settings.tsx'
import { Summary } from './screens/Summary.tsx'
import { TABS } from './screens/tabs.ts'
import { ReadingProvider } from './ui/reading.tsx'

/**
 * Роутинг через хеш: на GitHub Pages обычные пути дают 404 при обновлении
 * страницы — сервер ищет файл, которого нет. Всё после # до сервера не доходит.
 *
 * Общий интерфейс ядра — нижняя панель, «Что нового», отчёт об ошибке —
 * берёт базу из `CoreProvider`. Синхронизации нет: провайдеру — `noSync` (Р-09).
 * Чтение срезов — одно на «Сводку» и «Семью»: `ReadingProvider` (Р-13).
 */
export function App() {
  return (
    <CoreProvider value={{ config, db, sync: noSync }}>
      <ReadingProvider>
        <HashRouter>
          <Routes>
            <Route path="/" element={<Layout tabs={TABS} />}>
              <Route index element={<Summary />} />
              <Route path="family" element={<Family />} />
              <Route path="settings" element={<Settings />} />
              {/* Незнакомый адрес — на главный, а не в пустоту. */}
              <Route path="*" element={<Navigate to="/" replace />} />
            </Route>
          </Routes>
        </HashRouter>
      </ReadingProvider>
    </CoreProvider>
  )
}
