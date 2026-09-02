export function createManualLockProvider() {
  return {
    id: 'manual',
    async installCode({ door }) {
      return {
        doorId: door.id,
        status: 'manual',
        message: 'Program this door in the KK Home app, then confirm all doors in Owner Bookings.',
      };
    },
    async removeCode({ door }) {
      return {
        doorId: door.id,
        status: 'manual',
        message: 'Remove this code in the KK Home app, then confirm all doors in Owner Bookings.',
      };
    },
  };
}
