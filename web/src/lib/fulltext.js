/**
 * Generate a stable DOM id from heading children. Used for outline anchors in
 * the article page and for the markdown renderer's heading ids.
 */
export function headingId(children) {
  const text = (Array.isArray(children) ? children.join('') : String(children || '')).trim();
  return text
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
    .replace(/^-|-$/g, '')
    || 'heading';
}
