// Entrada da página de roadmap (`/roadmap`). O dicionário do idioma já foi carregado pelo
// main.ts do cliente; aqui só ajustamos o documento e deixamos o app montar a tela.
import '@fontsource/pixelify-sans/400.css';
import './styles.css';
import { getLocale, tr } from '../../../shared/i18n';

document.body.classList.add('is-roadmap');
document.documentElement.lang = getLocale();
document.title = tr('Roadmap — Habblaud');
document.querySelector('meta[name="description"]')?.setAttribute(
  'content',
  tr('Roadmap do Habblaud: leitura do Hermes Pipeline e conversa com o agente.'),
);

export { start } from './app';
