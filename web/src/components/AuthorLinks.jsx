import { Link } from 'react-router-dom';
import { creatorDisplay } from '@/lib/items';
import { highlight } from '@/lib/highlight';

/**
 * Renders a creators array as a "; "-joined inline list, linking each creator
 * to /authors/:id when an id is present (older/legacy creator rows without a
 * resolvable creatorID render as plain text). Safe to nest inside a clickable
 * row (`onClick`-based) — link clicks call stopPropagation so they don't also
 * trigger the row's onSelect/onClick. Do NOT nest inside another <a>/<Link>.
 */
export function AuthorLinks({ creators, query, emptyText = '—', className }) {
  const list = creators || [];
  if (list.length === 0) return <span className={className}>{emptyText}</span>;

  return (
    <span className={className}>
      {list.map((c, i) => {
        const name = creatorDisplay(c);
        const label = query ? highlight(name, query) : name;
        return (
          <span key={c.id ?? `${c.lastName}-${c.firstName}-${i}`}>
            {i > 0 && '; '}
            {c.id != null ? (
              <Link
                to={`/authors/${c.id}`}
                onClick={(e) => e.stopPropagation()}
                className="hover:text-foreground hover:underline"
              >
                {label}
              </Link>
            ) : (
              label
            )}
          </span>
        );
      })}
    </span>
  );
}
