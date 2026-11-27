import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWithMocks } from '../../../test/load-with-mocks.mjs';

// #20: la página /invitacion/<id> solo muestra una invitación pendiente, vigente
// y de una organización activa. Lo demás es "ya no es válida".
const ID = '0b9a4c2e-6a7f-4d61-9a39-2f1f0c6f4d2a';
const state = { queries: [], row: null };
globalThis.__invView = state;

const { getInvitationLinkView } = await loadWithMocks('src/lib/auth/invitation-view.ts', {
  '@/lib/db': `export const prisma = { invitation: { findFirst: async (q) => {
    globalThis.__invView.queries.push(q); return globalThis.__invView.row;
  } } };`,
});

test('id que no es UUID: null sin consultar la BD', async () => {
  state.queries = [];
  assert.equal(await getInvitationLinkView('abc'), null);
  assert.equal(state.queries.length, 0);
});

test('solo pendiente, vigente y de organización activa', async () => {
  state.row = { id: ID, email: 'v@pos.test', expiresAt: new Date(Date.now() + 60_000), organization: { name: 'Tienda A' } };
  assert.deepEqual(await getInvitationLinkView(ID), { id: ID, email: 'v@pos.test', organizationName: 'Tienda A' });
  const { where } = state.queries.at(-1);
  assert.equal(where.id, ID);
  assert.equal(where.status, 'pending');
  assert.ok(where.expiresAt.gt instanceof Date);
  assert.deepEqual(where.organization, { isActive: true, isDeleted: false });
  state.row = null;
  assert.equal(await getInvitationLinkView(ID), null);
});
