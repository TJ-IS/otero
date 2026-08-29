/**
 * Generate a stable DOM id from heading children. Used for outline anchors in
 * the article page and for the markdown renderer's heading ids.
 */
function flattenText(children) {
  if (children == null || typeof children === 'boolean') return '';
  if (typeof children === 'string' || typeof children === 'number') return String(children);
  if (Array.isArray(children)) return children.map(flattenText).join('');
  if (typeof children === 'object' && children.props) {
    const type = children.type;
    if (type === 'sup' || type === 'sub') return '';
    return flattenText(children.props.children);
  }
  return '';
}

export function headingId(children) {
  const text = flattenText(children)
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text
    .toLowerCase()
    .replace(/[^\w\u4e00-\u9fa5]+/g, '-')
    .replace(/^-|-$/g, '')
    || 'heading';
}
