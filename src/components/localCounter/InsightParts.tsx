/** Whether the customer has the order: collected is green, cancelled red, anything else still at the shop. */
export const StatusBadge = ({ status }: { status: string }) => {
  if (status === 'collected') return <span className="counter-badge good">Collected</span>;
  if (status === 'cancelled') return <span className="counter-badge bad">Cancelled</span>;
  return <span className="counter-badge warn">Not collected</span>;
};

/** A bill number that opens the order in Orders / Pickup. */
export const OrderLink = ({ id, number, onOpen }: { id: string; number: string; onOpen: (orderId: string) => void }) => (
  <button type="button" className="counter-link-button counter-bill-link" onClick={() => onOpen(id)}>{number}</button>
);
