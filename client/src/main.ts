// Ponto de entrada do cliente: primeiro o dicionário do idioma ativo (só ele vai para o navegador), depois o app
// (client/src/app.ts ou client/src/roadmap/main.ts), porque vários módulos chamam tr() ao carregar. Se o dicionário
// não carregar, fica em português.
import { getLocale, registerDictionary, type Locale } from '../../shared/i18n';

const LOADERS: Partial<Record<Locale, () => Promise<Readonly<Record<string, string>>>>> = {
  en: () => import('../../shared/locales/en').then((m) => m.EN),
  es: () => import('../../shared/locales/es').then((m) => m.ES),
  fr: () => import('../../shared/locales/fr').then((m) => m.FR),
};

/** `/roadmap` e `/roadmap/` são a página de roadmap; o resto é o escritório. */
function isRoadmapRoute(): boolean {
  const path = location.pathname.replace(/\/+$/, '') || '/';
  return path === '/roadmap';
}

const locale = getLocale();
const load = LOADERS[locale];
const dictionary = load ? load().then((d) => registerDictionary(locale, d)).catch(() => undefined) : Promise.resolve();
const entry = isRoadmapRoute() ? import('./roadmap/main') : import('./app');
void dictionary.then(() => entry).then((app) => app.start());
