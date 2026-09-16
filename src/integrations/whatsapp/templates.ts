import { Capacitor } from '@capacitor/core';
import { MessageTemplate, OrderCreatedData, OrderCompletedData, OrderReadyForPickupData, PaymentConfirmationData } from './types';
import { POINTS_TO_CURRENCY_RATE } from '@/components/orders/PayLaterPaymentDialog';

/**
 * Configuration for receipt URLs
 */
const getReceiptBaseUrl = (): string => {
  // Use environment variable if available, otherwise detect from current location
  if (import.meta.env.VITE_RECEIPT_BASE_URL) {
    return import.meta.env.VITE_RECEIPT_BASE_URL;
  }

  // VITE_APP_ORIGIN is already baked into native builds for the WhatsApp API
  // base URL (see whatsapp-config.ts) - reuse it here too.
  if (import.meta.env.VITE_APP_ORIGIN) {
    return import.meta.env.VITE_APP_ORIGIN;
  }

  // On native platforms the WebView's own origin is a synthetic local
  // address (`https://localhost` on Android, `capacitor://localhost` on
  // iOS), never the real deployed domain, so it must never be used here -
  // fall straight through to the hardcoded production fallback instead.
  if (typeof window !== 'undefined' && !Capacitor.isNativePlatform()) {
    return window.location.origin;
  }

  // Fallback for native builds without env vars, SSR, or build time
  return 'https://pos.fahrudina.my.id';
};

/**
 * Get payment status in English
 */
const getPaymentStatusLabel = (status: string): string => {
  const statusMap: { [key: string]: string } = {
    'pending': 'Unpaid',
    'completed': 'Paid in Full',
    'down_payment': 'Down Payment',
    'refunded': 'Refunded'
  };
  return statusMap[status] || status;
};

/**
 * Warm, personalized closing lines shared by every notification template
 * (order completed, payment confirmation, ...). One is picked at random
 * per message so repeat customers don't see the exact same line every time.
 */
const WARM_CLOSINGS = [
  'Wishing you continued prosperity and good health! 🙏😊',
  'Thank you for your trust — have a wonderful day! ✨',
  'Wishing you and your family continued health. See you again soon! 🙏',
  'Thank you for your continued support — wishing you every success! 🌟',
  'Wishing you a smooth day and continued good health. We look forward to seeing you again! 😊',
];

const getRandomWarmClosing = (): string =>
  WARM_CLOSINGS[Math.floor(Math.random() * WARM_CLOSINGS.length)];

/**
 * WhatsApp Message Templates
 * Contains pre-defined message templates for different scenarios
 */
export const messageTemplates: MessageTemplate = {
  /**
   * Template for order creation notification
   */
  orderCreated: (data: OrderCreatedData): string => {
    const currentDate = new Date().toLocaleDateString('en-IN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
    const currentTime = new Date().toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });

    const estimatedDate = data.estimatedCompletion || 'To be confirmed';

    // Build services list from order items
    const servicesList = data.orderItems.length > 0 
      ? data.orderItems.map(item => {
          let serviceInfo = `Laundry Service: ${item.service_name}`;
          if (item.service_type === 'kilo' && item.weight_kg) {
            serviceInfo += `\nWeight (kg) = ${item.weight_kg}`;
          }
          if (item.service_type === 'unit' && item.quantity) {
            serviceInfo += `\nQuantity (units) = ${item.quantity}`;
          }
          serviceInfo += `\nPrice = Rp. ${item.service_price.toLocaleString('en-IN')},-`;
          return serviceInfo;
        }).join('\n\n')
      : 'Laundry Service: Regular';

    // Build points redeemed message if points were used for discount
    const pointsRedeemedMessage = data.pointsRedeemed && data.pointsRedeemed > 0
      ? `\n🎁 Points Redeemed: ${data.pointsRedeemed} points (-Rp. ${(data.discountAmount || data.pointsRedeemed * POINTS_TO_CURRENCY_RATE).toLocaleString('en-IN')},-)`
      : '';

    // Build points earned message if points were earned
    const pointsEarnedMessage = data.pointsEarned && data.pointsEarned > 0 && data.paymentStatus === 'completed'
      ? `\n🎉 Congratulations! You earned ${data.pointsEarned} laundry points! 🎉\n(1 point per kg/unit)`
      : '';

    // Combine points messages
    const pointsMessage = (pointsRedeemedMessage || pointsEarnedMessage)
      ? `${pointsRedeemedMessage}${pointsEarnedMessage}\n====================`
      : '';

    // Build discount section for the pricing block
    const discountSection = data.pointsRedeemed && data.pointsRedeemed > 0
      ? `\nPoints Discount = -Rp. ${(data.discountAmount || data.pointsRedeemed * POINTS_TO_CURRENCY_RATE).toLocaleString('en-IN')},-\nTotal = Rp. ${data.totalAmount.toLocaleString('en-IN')},-`
      : '';

    return `${data.storeInfo.name}
${data.storeInfo.address}
Phone: ${data.storeInfo.phone}
====================
Date: ${currentDate} - ${currentTime}
Name: ${data.customerName}
===================

${servicesList}

Subtotal = Rp. ${data.subtotal.toLocaleString('en-IN')},-${discountSection}

====================
Estimated Completion:
${estimatedDate}
====================
Status: ${getPaymentStatusLabel(data.paymentStatus)}
${pointsMessage}

Thank you for using our service! 🙏
====================
Click the link below to view your digital receipt
${getReceiptBaseUrl()}/receipt/${data.orderId}`;
  },

  /**
   * Template for order completion notification
   */
  orderCompleted: (data: OrderCompletedData): string => {
    const completedDate = new Date().toLocaleDateString('en-IN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
    const completedTime = new Date().toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });

    // Build services list from order items
    const servicesList = data.orderItems.length > 0 
      ? data.orderItems.map(item => {
          let serviceInfo = `Laundry Service: ${item.service_name}`;
          if (item.service_type === 'kilo' && item.weight_kg) {
            serviceInfo += `\nWeight (kg) = ${item.weight_kg}`;
          }
          return serviceInfo;
        }).join('\n\n')
      : 'Laundry Service: Regular';

    return `🎉 *LAUNDRY COMPLETE* 🎉

Hi ${data.customerName} 👋

${data.storeInfo.name}
${data.storeInfo.address}
Phone: ${data.storeInfo.phone}
====================
Completion Date: ${completedDate} - ${completedTime}
Receipt No: ${data.orderId.slice(-8).toUpperCase()}
Name: ${data.customerName}
===================

${servicesList}
Total Paid = Rp. ${data.totalAmount.toLocaleString('en-IN')},-

====================
Status: COMPLETE ✅
Completed at: ${data.completedAt}
Ready for pickup: YES
====================

Your laundry is clean, fresh, and ready for pickup! 🧺✨
Please visit the store and bring this receipt.

${getRandomWarmClosing()}

====================
Click the link below to view your digital receipt
${getReceiptBaseUrl()}/receipt/${data.orderId}`;
  },

  /**
   * Template for order ready for pickup notification
   */
  orderReadyForPickup: (data: OrderReadyForPickupData): string => {
    const readyDate = new Date().toLocaleDateString('en-IN', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    });
    const readyTime = new Date().toLocaleTimeString('en-IN', {
      hour: '2-digit',
      minute: '2-digit',
      hour12: false
    });

    // Build services list from order items
    const servicesList = data.orderItems.length > 0 
      ? data.orderItems.map(item => {
          let serviceInfo = `Laundry Service: ${item.service_name}`;
          if (item.service_type === 'kilo' && item.weight_kg) {
            serviceInfo += `\nWeight (kg) = ${item.weight_kg}`;
          }
          return serviceInfo;
        }).join('\n\n')
      : 'Laundry Service: Regular';

    return `📦 *LAUNDRY READY FOR PICKUP* 📦

Hi ${data.customerName},
Your laundry is ready. Please pick it up at ${data.storeInfo.name}

====================
Receipt No: ${data.orderId.slice(-8).toUpperCase()}

Total: Rp. ${data.totalAmount.toLocaleString('en-IN')},-
Payment Status: ${getPaymentStatusLabel(data.paymentStatus)}

Thank you for using our service! 🙏
====================
Click the link below to view your digital receipt
${getReceiptBaseUrl()}/receipt/${data.orderId}`;
  },

  /**
   * Template for payment confirmation notification (pay later payments)
   */
  paymentConfirmation: (data: PaymentConfirmationData): string => {
    // Build points earned message if points were earned
    const pointsEarnedMessage = data.pointsEarned && data.pointsEarned > 0
      ? `\n🎉 Congratulations! You earned ${data.pointsEarned} laundry points! 🎉`
      : '';

    return `✅ *PAYMENT CONFIRMATION* ✅

Hi ${data.customerName} 👋

Your payment has been confirmed, thank you! 💚
Payment Status: ${getPaymentStatusLabel(data.paymentStatus)}${pointsEarnedMessage}

${getRandomWarmClosing()}

====================
Click the link below to view your digital receipt
${getReceiptBaseUrl()}/receipt/${data.orderId}`;
  },
};

/**
 * Custom message builder for special cases
 */
export class MessageBuilder {
  /**
   * Create a custom order notification message
   */
  static customOrderMessage(
    customerName: string,
    orderId: string,
    customMessage: string
  ): string {
    return `📋 *Order Notification ${orderId}*

Hello ${customerName}!

${customMessage}

Thank you for using our service! 🙏

_Automated message from Smart Laundry POS_`;
  }

  /**
   * Create a reminder message
   */
  static reminderMessage(
    customerName: string,
    orderId: string,
    daysOverdue: number
  ): string {
    return `⏰ *Laundry Pickup Reminder*

Hello ${customerName}!

Your laundry order with ID *${orderId}* has been ready for pickup for ${daysOverdue} days.

Please pick up your laundry soon. Thank you! 🙏

_Automated message from Smart Laundry POS_`;
  }

  /**
   * Create a promotional message
   */
  static promotionalMessage(
    customerName: string,
    promoDetails: string
  ): string {
    return `🎁 *Special Offer For You!*

Hello ${customerName}! ✨

${promoDetails}

Do not miss this opportunity! 🚀

_Message from Smart Laundry POS_`;
  }
}
