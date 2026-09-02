function failedDoorIds(env) {
  return new Set(String(env.LOCK_SIMULATOR_FAIL_DOORS || '').split(',').map((value) => value.trim()).filter(Boolean));
}

export function createSimulatedLockProvider(env = process.env) {
  const failures = failedDoorIds(env);
  const result = (action, door, idempotencyKey) => {
    if (failures.has(door.id)) throw new Error(`Simulated ${action} failure for ${door.name}.`);
    return {
      doorId: door.id,
      status: action === 'install' ? 'installed' : 'removed',
      providerCodeId: `sim-${idempotencyKey}-${door.id}`,
      message: `Simulated ${action} completed. No physical lock was contacted.`,
    };
  };
  return {
    id: 'simulated',
    async installCode({ door, idempotencyKey }) { return result('install', door, idempotencyKey); },
    async removeCode({ door, idempotencyKey }) { return result('remove', door, idempotencyKey); },
  };
}
