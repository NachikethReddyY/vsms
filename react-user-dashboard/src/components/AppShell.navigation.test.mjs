import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const shell = readFileSync(new URL('./AppShell.tsx', import.meta.url), 'utf8');
const eventsPage = readFileSync(new URL('./EventsPage.tsx', import.meta.url), 'utf8');
const styles = readFileSync(new URL('./EventsPage.css', import.meta.url), 'utf8');

test('the workspace owns the only responsive navigation shell', () => {
  assert.doesNotMatch(eventsPage, /events-site-nav|events-mobile-dock|events-mobile-header/);
  assert.match(shell, /className="workspace-mobile-dock"/);
  assert.match(shell, /className="workspace-mobile-header"/);
  assert.match(styles, /@media \(max-width:680px\)[\s\S]*?\.workspace-site-nav \{ display:none; \}/);
});

test('event managers receive a global Operations Center navigation entry', () => {
  assert.match(shell, /to="\/operations"[\s\S]*?>Operations<\/NavLink>/);
  assert.match(shell, /to="\/operations" aria-label="Operations"/);
});
