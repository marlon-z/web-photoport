import {normalizeLanguage, translate, templateKey, isMessage, preferredLanguage} from './i18n.js';

const storageKey = 'photoport.language';
let language = 'en';
try { language = preferredLanguage(localStorage.getItem(storageKey)); } catch {}
export const getLanguage = () => language;
export const tr = text => translate(text, language);
export const msg = (parts, ...values) => translate(templateKey(parts), language, values);
export const localizedURL = path => path + (path.includes('?') ? '&' : '?') + 'lang=' + language;
const tracked = [];

export function initLanguage() {
  // Capture the static document once, before source records are rendered.
  // We deliberately do not observe arbitrary DOM changes or translate data.
  const walker = document.createTreeWalker(document.documentElement, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode, parent = node.parentElement;
    if (!parent || parent.closest('script,style,[data-no-i18n]') || !isMessage(node.data.trim())) continue;
    const [,left,source,right] = node.data.match(/^(\s*)([\s\S]*?)(\s*)$/);
    tracked.push(() => { if (node.isConnected) node.data = left + tr(source) + right; });
  }
  for (const element of document.querySelectorAll('[placeholder],[aria-label],[title],meta[name="description"]')) {
    for (const name of ['placeholder','aria-label','title','content']) {
      const source = element.getAttribute(name);
      if (source && isMessage(source)) tracked.push(() => { if (element.isConnected) element.setAttribute(name,tr(source)); });
    }
  }
  const apply = () => {
    document.documentElement.lang = language;
    for (const update of tracked) update();
    for (const select of document.querySelectorAll('[data-language]')) {
      select.value = language;
      select.setAttribute('aria-label', language === 'en' ? 'Language' : '语言');
    }
    for (const link of document.querySelectorAll('[data-docs-link]')) link.href = 'https://github.com/marlon-z/web-photoport/blob/main/' + (language === 'en' ? 'README.md' : 'README.zh-CN.md');
    for (const link of document.querySelectorAll('[data-waitlist-link]')) link.href = 'https://photoport-local.pages.dev/' + (language === 'en' ? '' : 'zh/') + '#waitlist';
  };
  for (const select of document.querySelectorAll('[data-language]')) select.addEventListener('change', () => {
    language = normalizeLanguage(select.value);
    try { localStorage.setItem(storageKey,language); } catch {}
    apply();
    document.dispatchEvent(new CustomEvent('photoport:language'));
  });
  apply();
}
