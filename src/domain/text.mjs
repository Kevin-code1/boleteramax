import { timingSafeEqual } from 'crypto';

export function normalizeText(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .trim();
}

export function normalizeTextVariants(value = '') {
  const raw = String(value || '');
  const variants = new Set([normalizeText(raw)]);
  try {
    variants.add(normalizeText(Buffer.from(raw, 'latin1').toString('utf8')));
  } catch (_) {
    // Keep the raw normalized value when a string cannot be repaired.
  }
  return variants;
}

export function textValuesMatch(left = '', right = '') {
  const leftValues = normalizeTextVariants(left);
  const rightValues = normalizeTextVariants(right);
  return [...leftValues].some(value => value && rightValues.has(value));
}

export function normalizeZoneLabel(value = '') {
  return normalizeText(value).replace(/[^a-z0-9]+/g, ' ').trim();
}

export function slugify(value = '') {
  return String(value)
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

export function safeEqualString(left = '', right = '') {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  return leftBuffer.length === rightBuffer.length && timingSafeEqual(leftBuffer, rightBuffer);
}
