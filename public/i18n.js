import english from './messages.en.js';

export const languages = ['zh-CN', 'en'];
export const normalizeLanguage = value => /^en(?:-|$)/i.test(String(value || '')) ? 'en' : 'zh-CN';
const escapeRegExp = value => value.replace(/[.*+?^{}$()|[\]\\]/g, '\\$&');
const patterns = [];
const reverse = new Map();
for (const [source, target] of Object.entries(english)) {
  reverse.set(target, source);
  if (/\{\d+\}/.test(source)) {
    const compile = text => {
      const indices = [];
      const pieces = text.split(/(\{\d+\})/);
      return {regex: new RegExp('^' + pieces.map(part => {
        if (/^\{\d+\}$/.test(part)) { indices.push(Number(part.slice(1,-1))); return '([\\s\\S]*?)'; }
        return escapeRegExp(part);
      }).join('') + '$'), indices};
    };
    patterns.push({source, target, zh:compile(source), en:compile(target)});
  }
}
const interpolate = (text, values) => text.replace(/\{(\d+)\}/g, (match, index) => index in values ? String(values[index]) : match);

// Only pass application-owned text here. Never translate table values, field
// names, record labels or filenames, even if they happen to match a message.
export function translate(message, language='zh-CN', values=[]) {
  const text = String(message ?? ''), locale = normalizeLanguage(language);
  if (Object.hasOwn(english, text)) return interpolate(locale === 'en' ? english[text] : text, values);
  if (reverse.has(text)) return interpolate(locale === 'en' ? text : reverse.get(text), values);
  for (const pattern of patterns) {
    const from = locale === 'en' ? pattern.zh : pattern.en;
    const match = from.regex.exec(text);
    if (!match) continue;
    const params = [];
    from.indices.forEach((index, i) => { params[index] = match[i+1]; });
    return interpolate(locale === 'en' ? pattern.target : pattern.source, params);
  }
  return interpolate(text, values);
}
export function templateKey(parts) {
  return parts.reduce((text, part, i) => text + (i ? '{' + (i-1) + '}' : '') + part, '');
}
