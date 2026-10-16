# Admin page authoring guide

The admin is `apps/admin` (Next.js 16 App Router, React 19, TypeScript, **no extra dependencies**). It talks to the Go
API through the same-origin `/api/*` proxy. Read before writing pages:

- `docs/API.md` — every endpoint, payload and response shape (source of truth).
- `apps/admin/lib/api.ts` — `get`, `post`, `put`, `del`, `list` (paginated), `download` (CSV export), `uploadFile(purpose, targetId, file, onProgress)`, `ApiError`.
- `apps/admin/lib/auth.tsx` — `useAuth()` → `{user, can(...roles), scopeTenantId, tenants, reloadTenants}` and `useTenantQuery()` → `{tenant_id?}` to pass to list endpoints (super admin's tenant scope selector in the top bar; `null` = All Network).
- `apps/admin/lib/types.ts` — response types.
- `apps/admin/components/ui.tsx` — UI kit: `useAsync(fn, deps)`, `useAction()` (run with toast), `useToast`, `Button`, `LinkButton`,
  `Input`, `Textarea`, `Select`, `Checkbox`, `Field`, `Card`, `PageHeader`, `Badge` (status badge), `Spinner`, `ErrorBox`, `Empty`,
  `Tabs`, `Modal`, `Stat`, `Progress`, `Pager`, `BarList`, `LineChart`, `ConfirmButton`, `ImageUpload`, `fmtDate`, `fmtBytes`, `fmtDuration`, `errMsg`, `cx`.
- `apps/admin/app/globals.css` — all styling classes (`card`, `table-wrap` + `table.table`, `grid-2/3/4`, `row`, `stack`, `muted`, `small`,
  `mono`, `alert alert--error|warn|info|success`, `checklist` (`ok`/`no`), `kv`, `code`, `dist-grid`/`dist-card`, `theme-picker`/`theme-opt`,
  `sortable`, `upload-zone`, `platform-dot`, `cell-title`, `thumb`). Prefer these; add new rules to globals.css only if really needed
  (append at the end under a comment with your area name).
- Reference pages: `apps/admin/app/page.tsx` (dashboard), `apps/admin/components/Shell.tsx` (navigation: the hrefs there are the routes you must implement).

## Conventions
- Every page file starts with `'use client';` and default-exports a component. Dynamic routes read params with `useParams()` from `next/navigation`
  (do NOT use server `params` props). Use `useSearchParams()` for query strings (wrap the component using it in `<Suspense>` if needed).
- Data loading: `const { data, error, loading, reload } = useAsync(() => get<T>('/x', tq), [scopeTenantId, ...])`. Show `<Spinner/>` while loading,
  `<ErrorBox error onRetry={reload}/>` on error, `<Empty>` for empty lists.
- Mutations: `const { run, busy } = useAction(); await run(() => post('/x', body), 'Saved');` then `reload()`.
- Respect roles in the UI (hide actions the user can't perform: `can('SUPER_ADMIN','TENANT_ADMIN')` etc.) — the backend still enforces them.
- Plain `<a href>` for navigation (or `useRouter().push`). Accessible labels on every input, buttons have text or aria-label.
- Responsive: tables inside `.table-wrap` (scrolls horizontally), forms in `.grid-2` collapse on mobile.
- Dates: `fmtDate`. Status: `<Badge status={x.status}/>`.
- Run `npx tsc --noEmit` inside `apps/admin` when done; fix all errors in your files. Do not modify files owned by other areas
  (`lib/*`, `components/ui.tsx`, `components/Shell.tsx`, `app/layout.tsx`, `app/page.tsx`) — if you truly need a shared helper, put it in a new file
  under `apps/admin/components/<your-area>/`.
- You can test against the running stack: API on http://localhost:8080, admin dev server on http://localhost:3001 (login
  `admin@example.com` / `ChangeMe123!` super admin; `admin@podcastbusiness.localhost` / `ChangeMe123!` tenant admin). E.g.
  `curl -s -X POST localhost:8080/api/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@example.com","password":"ChangeMe123!"}'`
  then call endpoints with the token to see real response shapes. Do NOT delete or destructively modify demo data.
