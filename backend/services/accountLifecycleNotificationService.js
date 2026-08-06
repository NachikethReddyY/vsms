// Email delivery is owned by the lifecycle-email implementation. Account
// transactions call this only after commit, and the default seam is harmless.
async function enqueueAccountLifecycle() {
  return { queued: false };
}

module.exports = { enqueueAccountLifecycle };
