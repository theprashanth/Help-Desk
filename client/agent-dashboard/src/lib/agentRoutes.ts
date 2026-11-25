/**
 * Every dashboard screen has its own address, so refresh, Back/Forward and shared links work:
 *   /agent/inbox                     Your inbox
 *   /agent/inbox/<view>?c=<id>       another view (all, unassigned, kind:ticket, agent:<id>, ai…), a conversation open
 *   /agent/inbox/search              search
 *   /agent/contacts[/<id>]           Contacts, one contact
 *   /agent/analytics                 Reports
 *   /agent/settings[/<section>]      Settings home, one section (e.g. /agent/settings/ai-agent)
 *   /agent/testing                   Testing panel
 */

export const AREAS = ['contacts', 'analytics', 'settings', 'testing'] as const;
type Area = typeof AREAS[number];
const isArea = (s: string | undefined): s is Area => !!s && (AREAS as readonly string[]).includes(s);

const parts = (pathname: string) => pathname.split('/').filter(Boolean); // ['agent', 'inbox', 'all']

/** The Inbox page's "tab": an inbox view id, 'search', or one of the areas. */
export function tabFromPath(pathname: string): string {
  const [, area, sub] = parts(pathname);
  if (isArea(area)) return area;
  if (area === 'inbox' && sub) return decodeURIComponent(sub);
  return 'yours';
}

export function pathForTab(tab: string): string {
  if (isArea(tab)) return `/agent/${tab}`;
  if (!tab || tab === 'yours') return '/agent/inbox';
  return `/agent/inbox/${encodeURIComponent(tab)}`;
}

/** The part after the area: a contact id, or a settings section slug. */
export function subOf(pathname: string): string | undefined {
  const [, , sub] = parts(pathname);
  return sub ? decodeURIComponent(sub) : undefined;
}

// Settings sections are camelCase in code ("aiAgent") and kebab-case in the address ("ai-agent")
export const sectionToSlug = (s: string) => s.replace(/[A-Z]/g, c => `-${c.toLowerCase()}`);
export const slugToSection = (s: string) => s.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
export const settingsPath = (section?: string) => (!section || section === 'home' ? '/agent/settings' : `/agent/settings/${sectionToSlug(section)}`);
