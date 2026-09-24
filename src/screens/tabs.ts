import type { Tab } from '../shared/ui/Layout.tsx'

/**
 * Вкладки нижней панели. Адреса постоянные: на них ведут ссылки, и старый
 * адрес обязан работать после любой правки. Подписи — отсюда, тексты
 * экранов ссылаются на них, а не пишут их заново.
 */
export const SUMMARY_TAB: Tab = { to: '/', name: 'Сводка', end: true }
export const FAMILY_TAB: Tab = { to: '/family', name: 'Семья', end: false }

export const TABS: readonly Tab[] = [SUMMARY_TAB, FAMILY_TAB]
