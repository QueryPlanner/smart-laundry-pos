/** The customer fields of the order being taken. `addressLocked` only drives the New order screen. */
export interface CustomerDraft {
  name: string;
  phone: string;
  address: string;
  customerId?: string;
  /** An existing customer's saved address is corrected on the Customers screen, not here. */
  addressLocked?: boolean;
}

export const blankCustomer: CustomerDraft = { name: '', phone: '', address: '' };
