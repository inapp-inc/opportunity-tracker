import test from 'node:test';
import assert from 'node:assert/strict';
import {
  PERMISSIONS,
  PLATFORM_ROLES,
  TENANT_ROLES,
  legacyRoleFromMembership,
  permissionsForMembership,
  tenantRoleFromLegacyRole,
} from '../src/rbac.js';

test('tenant role templates match platform RBAC rules', () => {
  const tenantAdmin = permissionsForMembership({
    role: TENANT_ROLES.TENANT_ADMIN,
    permissions_json: '[]',
  });
  const manager = permissionsForMembership({
    role: TENANT_ROLES.MANAGER,
    permissions_json: '[]',
  });
  const viewer = permissionsForMembership({
    role: TENANT_ROLES.VIEWER,
    permissions_json: '[]',
  });

  assert.ok(tenantAdmin.includes(PERMISSIONS.TENANT_SETTINGS_WRITE));
  assert.ok(manager.includes(PERMISSIONS.RECORDS_CREATE));
  assert.ok(!manager.includes(PERMISSIONS.TENANT_SETTINGS_WRITE));
  assert.ok(viewer.includes(PERMISSIONS.RECORDS_READ));
  assert.ok(!viewer.includes(PERMISSIONS.RECORDS_UPDATE));
});

test('explicit membership permissions are additive and deduped', () => {
  const permissions = permissionsForMembership({
    role: TENANT_ROLES.VIEWER,
    permissions_json: JSON.stringify([
      PERMISSIONS.RECORDS_UPDATE,
      PERMISSIONS.RECORDS_UPDATE,
    ]),
  });

  assert.equal(
    permissions.filter((permission) => permission === PERMISSIONS.RECORDS_UPDATE).length,
    1
  );
  assert.ok(permissions.includes(PERMISSIONS.RECORDS_READ));
});

test('legacy compatibility roles derive from active membership', () => {
  assert.equal(
    legacyRoleFromMembership({ role: TENANT_ROLES.MANAGER }, PLATFORM_ROLES.NONE),
    'EDITOR'
  );
  assert.equal(
    legacyRoleFromMembership({ role: TENANT_ROLES.VIEWER }, PLATFORM_ROLES.PLATFORM_ADMIN),
    'ADMIN'
  );
  assert.equal(tenantRoleFromLegacyRole('ADMIN'), TENANT_ROLES.TENANT_ADMIN);
});
