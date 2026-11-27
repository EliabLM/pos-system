import test from 'node:test';
import assert from 'node:assert/strict';
import { loadWithMocks } from '../../../test/load-with-mocks.mjs';

// #20: después de entrar o registrarse desde un enlace de invitación, se vuelve
// a esa invitación. Solo se acepta un id de invitación (nunca una URL libre).
const { invitationReturnPath } = await loadWithMocks('src/lib/auth/invitation-link.ts', {});

const ID = '0b9a4c2e-6a7f-4d61-9a39-2f1f0c6f4d2a';

test('id de invitación válido: vuelve a /invitacion/<id>', () => {
  assert.equal(invitationReturnPath(ID), `/invitacion/${ID}`);
  assert.equal(invitationReturnPath([ID]), null, 'un parámetro repetido no vale');
});

test('cualquier otra cosa: null (sin redirección abierta)', () => {
  for (const value of [undefined, '', 'https://evil.example', '//evil.example', `${ID}/../../dashboard`, '../x']) {
    assert.equal(invitationReturnPath(value), null, String(value));
  }
});
