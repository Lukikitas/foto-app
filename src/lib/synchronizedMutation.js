export async function runSynchronizedMutation({ apply, commit, rollback }) {
  const applied = await apply();
  try {
    return await commit(applied);
  } catch (error) {
    try {
      await rollback(applied);
    } catch (rollbackError) {
      error.rollbackError = rollbackError;
    }
    throw error;
  }
}
