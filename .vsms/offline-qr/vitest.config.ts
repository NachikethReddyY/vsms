export default {
  root: new URL('../../react-user-dashboard', import.meta.url).pathname,
  test: {
    environment: 'node',
    restoreMocks: true,
    include: ['../.vsms/offline-qr/*.test.ts'],
  },
};
