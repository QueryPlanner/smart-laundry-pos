/**
 * Shown on every screen while a restored backup waits for the next start. Writes are blocked until
 * then, and the restore replaces the accounts too, so the wording says what the owner gets back.
 */
export const RestorePendingBanner = () => (
  <p className="counter-restore-banner" role="alert">
    A backup restore is staged. Close and reopen Smart Laundry to apply it; changes are blocked until then.
    Restoring brings back the accounts and PINs from that backup, including staff who were deactivated since it was made.
    Check the Staff list in Admin after the restart.
  </p>
);
