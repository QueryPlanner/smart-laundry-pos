export const ORDER_STATUSES = [
  'received',
  'washing',
  'drying',
  'ironing',
  'quality_check',
  'packing',
  'ready',
  'collected',
  'cancelled',
] as const;

export type OrderStatus = typeof ORDER_STATUSES[number];

export const PAYMENT_METHODS = [
  'cash',
  'upi',
  'card',
  'bank_transfer',
  'credit',
  'other',
] as const;

export type PaymentMethod = typeof PAYMENT_METHODS[number];
export type PaymentStatus = 'unpaid' | 'partially_paid' | 'paid' | 'overpaid';
export type DiscountType = 'fixed' | 'percentage';
export type ServiceType = 'piece' | 'weight' | 'combined';
export type CustomerType = 'regular' | 'student' | 'hostel' | 'other';

export interface LocalUser {
  id: string;
  full_name: string;
  role: 'admin';
  created_at: string;
  updated_at: string;
}

export interface ShopSettings {
  shop_name: string;
  shop_address: string;
  shop_phone: string;
  gst_number: string;
  receipt_footer: string;
  order_prefix: string;
  default_completion_days: number;
  device_id: string;
}

export interface Customer {
  id: string;
  customer_code: string;
  name: string;
  phone: string;
  alternate_phone: string | null;
  address: string | null;
  customer_type: CustomerType;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Service {
  id: string;
  name: string;
  description: string | null;
  category: string;
  price_per_piece: number | null;
  price_per_kg: number | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface OrderItemInput {
  item_name: string;
  service_id?: string;
  service_name: string;
  service_type: ServiceType;
  quantity: number;
  weight_kg: number;
  rate: number;
}

export interface OrderItem extends OrderItemInput {
  id: string;
  line_total: number;
}

export interface Payment {
  id: string;
  order_id: string;
  amount: number;
  method: PaymentMethod;
  reference_number: string | null;
  notes: string | null;
  recorded_at: string;
  recorded_by: string;
  voided_at: string | null;
  void_reason: string | null;
}

export interface LocalOrder {
  id: string;
  order_number: string;
  customer_id: string | null;
  customer_name: string;
  customer_phone: string;
  order_type: 'piece' | 'weight' | 'combined';
  received_at: string;
  expected_ready_at: string | null;
  status: OrderStatus;
  subtotal: number;
  discount_type: DiscountType;
  discount_value: number;
  discount_amount: number;
  total_amount: number;
  payment_status: PaymentStatus;
  special_instructions: string | null;
  damage_notes: string | null;
  internal_notes: string | null;
  created_at: string;
  updated_at: string;
  items?: OrderItem[];
  payments?: Payment[];
  paid_amount?: number;
}

export interface CreateOrderInput {
  customer_id?: string;
  customer_name: string;
  customer_phone: string;
  order_type: 'piece' | 'weight' | 'combined';
  expected_ready_at?: string;
  items: OrderItemInput[];
  discount_type?: DiscountType;
  discount_value?: number;
  special_instructions?: string;
  damage_notes?: string;
  internal_notes?: string;
  payment?: {
    amount: number;
    method: PaymentMethod;
    reference_number?: string;
    notes?: string;
  };
}

export interface Expense {
  id: string;
  expense_date: string;
  category: string;
  description: string | null;
  amount: number;
  payment_method: Exclude<PaymentMethod, 'credit'>;
  notes: string | null;
  created_at: string;
}

export interface InventoryItem {
  id: string;
  name: string;
  current_quantity: number;
  unit: string;
  minimum_quantity: number;
  purchase_cost: number | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface Machine {
  id: string;
  name: string;
  machine_type: string;
  capacity: string | null;
  purchase_date: string | null;
  last_maintenance_date: string | null;
  next_maintenance_date: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export interface DashboardSummary {
  orders_today: number;
  pieces_today: number;
  weight_today: number;
  sales_today: number;
  collected_today: number;
  outstanding: number;
  in_process: number;
  ready: number;
  overdue: number;
}

export interface ReportSummary extends DashboardSummary {
  completed_orders: number;
  expenses: number;
  estimated_profit: number;
  average_order_value: number;
}
