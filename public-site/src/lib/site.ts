/**
 * Links out to the LeadLoop product app (the dashboard). Auth and the app
 * itself live in the separate Vite SPA (`site/client`), deployed on its own
 * URL — the marketing site never handles credentials, it just points visitors
 * at the app's own login / signup pages.
 *
 * Configured via NEXT_PUBLIC_APP_URL (see .env.example). Falls back to the
 * local Vite dev server so the links work with zero config in development.
 */
const APP_URL = (
  process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:5173"
).replace(/\/+$/, "")

export const appUrl = APP_URL
export const loginUrl = `${APP_URL}/login`
export const signupUrl = `${APP_URL}/signup`
