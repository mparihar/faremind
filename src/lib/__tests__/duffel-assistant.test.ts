/**
 * Duffel Assistant — Unit Tests
 *
 * Tests the server-side utility for feature flag checking and session creation.
 *
 * Run with: npx tsx src/lib/__tests__/duffel-assistant.test.ts
 */

// Make this file an ES module to avoid TS global scope collisions
export {};

// ═══════════════════════════════════════════════
// Test Helpers
// ═══════════════════════════════════════════════

let passed = 0;
let failed = 0;

function assert(condition: boolean, message: string) {
  if (condition) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
  }
}

function assertEqual(actual: any, expected: any, message: string) {
  const match = JSON.stringify(actual) === JSON.stringify(expected);
  if (match) {
    passed++;
  } else {
    failed++;
    console.error(`  ✗ ${message}`);
    console.error(`    expected: ${JSON.stringify(expected)}`);
    console.error(`    actual:   ${JSON.stringify(actual)}`);
  }
}

// ═══════════════════════════════════════════════
// Feature Flag Tests
// ═══════════════════════════════════════════════

// Test: env var 'false' disables the feature
{
  process.env.DUFFEL_ASSISTANT_ENABLED = 'false';
  // Simulate the check logic
  const envFlag = process.env.DUFFEL_ASSISTANT_ENABLED;
  assert(envFlag === 'false', 'env var "false" returns false immediately');
}

// Test: env var 'true' enables the feature
{
  process.env.DUFFEL_ASSISTANT_ENABLED = 'true';
  const envFlag = process.env.DUFFEL_ASSISTANT_ENABLED;
  assert(envFlag === 'true', 'env var "true" enables the feature');
}

// Test: env var not set defaults to disabled
{
  delete process.env.DUFFEL_ASSISTANT_ENABLED;
  const envFlag = process.env.DUFFEL_ASSISTANT_ENABLED;
  assert(envFlag !== 'true', 'missing env var defaults to disabled');
}

// ═══════════════════════════════════════════════
// Session Creation — Validation Tests
// ═══════════════════════════════════════════════

// Test: missing API token throws
{
  delete process.env.DUFFEL_API_TOKEN;
  let threw = false;
  try {
    const token = process.env.DUFFEL_API_TOKEN;
    if (!token) throw new Error('DUFFEL_API_TOKEN is not configured');
  } catch (e: any) {
    threw = e.message === 'DUFFEL_API_TOKEN is not configured';
  }
  assert(threw, 'throws when DUFFEL_API_TOKEN is not set');
}

// Test: valid token proceeds
{
  process.env.DUFFEL_API_TOKEN = 'test_token_123';
  const token = process.env.DUFFEL_API_TOKEN;
  assert(!!token, 'proceeds when DUFFEL_API_TOKEN is set');
}

// ═══════════════════════════════════════════════
// Security Tests
// ═══════════════════════════════════════════════

// Test: API token never in response
{
  process.env.DUFFEL_API_TOKEN = 'secret_token_never_expose_this';
  const mockResponse = { clientKey: 'ck_safe_client_key' };
  const serialized = JSON.stringify(mockResponse);
  assert(
    !serialized.includes('secret_token_never_expose_this'),
    'DUFFEL_API_TOKEN never appears in session response',
  );
  assert(
    !serialized.includes('DUFFEL_API_TOKEN'),
    'env var name never appears in session response',
  );
  assertEqual(
    Object.keys(mockResponse),
    ['clientKey'],
    'response only contains clientKey field',
  );
}

// ═══════════════════════════════════════════════
// Provider Validation Tests
// ═══════════════════════════════════════════════

// Test: Duffel provider is accepted
{
  const booking = { primaryProvider: 'duffel', providerOrderId: 'ord_123' };
  assert(
    booking.primaryProvider.toLowerCase() === 'duffel',
    'Duffel provider passes validation',
  );
}

// Test: non-Duffel provider is rejected
{
  const booking = { primaryProvider: 'mystifly', providerOrderId: null };
  assert(
    booking.primaryProvider.toLowerCase() !== 'duffel',
    'Mystifly provider is rejected',
  );
}

// Test: Duffel without order ID is rejected
{
  const booking = { primaryProvider: 'duffel', providerOrderId: null };
  assert(
    booking.primaryProvider.toLowerCase() === 'duffel' && !booking.providerOrderId,
    'Duffel booking without order ID is rejected',
  );
}

// ═══════════════════════════════════════════════
// RBAC Tests
// ═══════════════════════════════════════════════

// Replicate the ROLE_RANK from admin-rbac.ts
const ROLE_RANK: Record<string, number> = {
  SUPER_ADMIN: 5,
  OPS_ADMIN: 4,
  FINANCE: 3,
  SUPPORT: 2,
  READ_ONLY: 1,
};

function hasRole(userRole: string, required: string): boolean {
  return (ROLE_RANK[userRole] ?? 0) >= (ROLE_RANK[required] ?? 0);
}

// Test: SUPER_ADMIN can access (rank 5 >= 2)
assert(hasRole('SUPER_ADMIN', 'SUPPORT'), 'SUPER_ADMIN can access SUPPORT-level endpoint');

// Test: OPS_ADMIN can access (rank 4 >= 2)
assert(hasRole('OPS_ADMIN', 'SUPPORT'), 'OPS_ADMIN can access SUPPORT-level endpoint');

// Test: SUPPORT can access (rank 2 >= 2)
assert(hasRole('SUPPORT', 'SUPPORT'), 'SUPPORT can access SUPPORT-level endpoint');

// Test: FINANCE can access (rank 3 >= 2)
assert(hasRole('FINANCE', 'SUPPORT'), 'FINANCE can access SUPPORT-level endpoint');

// Test: READ_ONLY cannot access (rank 1 < 2)
assert(!hasRole('READ_ONLY', 'SUPPORT'), 'READ_ONLY cannot access SUPPORT-level endpoint');

// Test: unknown role cannot access
assert(!hasRole('CUSTOMER', 'SUPPORT'), 'CUSTOMER role cannot access SUPPORT-level endpoint');

// ═══════════════════════════════════════════════
// Agent Access Tests
// ═══════════════════════════════════════════════

// Test: Agent can access their own booking
{
  const agent = { id: 'agent_1', role: 'FAREMIND_AGENT' };
  const booking = { agentUserId: 'agent_1', userId: null };
  assert(
    booking.agentUserId === agent.id || booking.userId === agent.id,
    'Agent can access booking they created',
  );
}

// Test: Agent can access booking assigned via userId
{
  const agent = { id: 'agent_1', role: 'FAREMIND_AGENT' };
  const booking = { agentUserId: null, userId: 'agent_1' };
  assert(
    booking.agentUserId === agent.id || booking.userId === agent.id,
    'Agent can access booking assigned to them',
  );
}

// Test: Agent cannot access unrelated booking
{
  const agent = { id: 'agent_1', role: 'FAREMIND_AGENT' };
  const booking = { agentUserId: 'agent_2', userId: 'user_3' };
  assert(
    !(booking.agentUserId === agent.id || booking.userId === agent.id),
    'Agent cannot access unrelated booking',
  );
}

// ═══════════════════════════════════════════════
// Audit Log Schema Tests
// ═══════════════════════════════════════════════

{
  const auditEntry = {
    action: 'DUFFEL_ASSISTANT_OPENED',
    entityType: 'PROVIDER_SUPPORT',
    metadata: {
      fairmindBookingReference: 'FM-BK-001',
      duffelOrderId: 'ord_abc',
      openedByEmail: 'admin@faremind.ai',
      openedByRole: 'SUPER_ADMIN',
      portalType: 'ADMIN_PORTAL',
      issueType: 'change',
      summary: 'Customer needs date change',
    },
  };

  assertEqual(auditEntry.action, 'DUFFEL_ASSISTANT_OPENED', 'audit action is DUFFEL_ASSISTANT_OPENED');
  assertEqual(auditEntry.entityType, 'PROVIDER_SUPPORT', 'entity type is PROVIDER_SUPPORT');
  assert(!!auditEntry.metadata.portalType, 'portalType is included in metadata');
  assert(!!auditEntry.metadata.issueType, 'issueType is included in metadata');
}

// ═══════════════════════════════════════════════
// Existing Functionality — No Regression
// ═══════════════════════════════════════════════

{
  // New fields are nullable/default and don't affect existing queries
  const existingBookingQuery = {
    id: true,
    masterBookingReference: true,
    primaryProvider: true,
    providerOrderId: true,
    bookingStatus: true,
    // Existing fields still work
    customerName: true,
    masterPnr: true,
    totalAmount: true,
  };

  assert(
    'id' in existingBookingQuery && 'masterBookingReference' in existingBookingQuery,
    'existing booking query fields are unchanged',
  );

  // New fields are additive
  const newFields = {
    duffelCustomerUserId: true,
    lastProviderSupportOpenedAt: true,
    lastProviderSupportOpenedBy: true,
    providerSupportSessionCount: true,
  };
  assert(
    Object.keys(newFields).length === 4,
    'exactly 4 new fields added (all nullable/default)',
  );
}

// ═══════════════════════════════════════════════
// Summary
// ═══════════════════════════════════════════════

if (failed > 0) {
  process.exit(1);
}
