import { useMemo, useState } from 'react';
import { Search } from 'lucide-react';
import RecipeCard from './RecipeCard';

/**
 * RecipeCatalogue — the F6 recipe card grid with a region filter (F6.4).
 *
 * Receives the already-fetched recipe list and renders a responsive grid of
 * RecipeCards. The region filter narrows to region-agnostic recipes plus those
 * tagged for the selected region; a text search filters by name/description.
 *
 * Props:
 *   recipes      — [{ slug, name, description, region, requiresSetup, ... }]
 *   onUse(recipe)
 *   busySlug     — slug currently being cloned (button shows "Adding…")
 *   useDisabled  — disables every "Use recipe" button (e.g. no board chosen)
 *   loading, error
 */

const REGION_OPTIONS = ['All regions', 'Edmonton', 'Saskatoon', 'Regina', 'Montreal'];

const RecipeCatalogue = ({
  recipes = [],
  onUse,
  busySlug = null,
  useDisabled = false,
  loading = false,
  error = null,
}) => {
  const [region, setRegion] = useState('All regions');
  const [query, setQuery] = useState('');

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return recipes.filter((r) => {
      const regions = Array.isArray(r.region) ? r.region : [];
      const regionOk =
        region === 'All regions' || regions.length === 0 || regions.includes(region);
      const textOk =
        !q ||
        (r.name || '').toLowerCase().includes(q) ||
        (r.description || '').toLowerCase().includes(q);
      return regionOk && textOk;
    });
  }, [recipes, region, query]);

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center gap-3">
        <div
          className="flex items-center gap-2"
          style={{
            flex: '1 1 220px',
            height: 38,
            padding: '0 10px',
            borderRadius: 'var(--radius-md)',
            border: '1.5px solid var(--color-border)',
            background: 'var(--color-bg-input)',
          }}
        >
          <Search size={15} color="var(--color-text-muted)" aria-hidden="true" />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search recipes…"
            className="font-body w-full"
            style={{ border: 'none', outline: 'none', background: 'transparent', fontSize: 13, color: 'var(--color-text-primary)' }}
          />
        </div>
        <select
          value={region}
          onChange={(e) => setRegion(e.target.value)}
          className="font-body"
          style={{
            height: 38,
            padding: '0 10px',
            borderRadius: 'var(--radius-md)',
            border: '1.5px solid var(--color-border)',
            background: 'var(--color-bg-input)',
            color: 'var(--color-text-primary)',
            fontSize: 13,
          }}
        >
          {REGION_OPTIONS.map((r) => (
            <option key={r} value={r}>{r}</option>
          ))}
        </select>
      </div>

      {error && (
        <p className="font-body text-xs" style={{ color: 'var(--color-status-stuck)' }}>
          {error}
        </p>
      )}

      {loading ? (
        <p className="font-body" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          Loading recipes…
        </p>
      ) : filtered.length === 0 ? (
        <p className="font-body" style={{ fontSize: 13, color: 'var(--color-text-muted)' }}>
          No recipes match your filter.
        </p>
      ) : (
        <div
          className="grid gap-3"
          style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}
        >
          {filtered.map((r) => (
            <RecipeCard
              key={r.slug}
              recipe={r}
              onUse={onUse}
              busy={busySlug === r.slug}
              disabled={useDisabled}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default RecipeCatalogue;
