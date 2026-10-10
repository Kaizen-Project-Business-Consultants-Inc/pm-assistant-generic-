import { Link } from 'react-router-dom';
import { ROUTES } from '../../routes';
import { useCanOpenPage } from '../../hooks/useCanOpenPage';

/** "Clients › <name>" above a client's pages. Clients is a link only for roles that may open
 *  the Clients page (constants/roleRoutes.ts); team members reach these pages from Projects. */
export function ClientBreadcrumb({ name }: { name: string }) {
  const canOpen = useCanOpenPage();
  return (
    <nav aria-label="Breadcrumb" className="text-sm text-gray-500 dark:text-gray-400">
      {/* A list, the link underlined (not told apart by colour alone), the last crumb marked current */}
      <ol className="flex items-center">
        <li>
          {canOpen(ROUTES.clients)
            ? <Link to={ROUTES.clients} className="underline underline-offset-2 text-primary-600 dark:text-primary-400">Clients</Link>
            : <span>Clients</span>}
        </li>
        <li className="flex items-center">
          <span className="mx-1.5" aria-hidden="true">›</span>
          <span aria-current="page" className="text-gray-700 dark:text-gray-200">{name}</span>
        </li>
      </ol>
    </nav>
  );
}
