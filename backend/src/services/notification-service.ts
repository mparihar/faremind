/**
 * Notification Service — Provider-Agnostic Abstraction
 *
 * Channels:
 * - Email   → Always enabled (via Brevo/SendInBlue)
 * - InApp   → Always enabled (writes to Notification table)
 * - SMS     → Disabled until configured (Twilio-ready)
 *
 * This service provides a unified interface for sending notifications
 * across all channels. The SMS channel is designed to be plug-and-play
 * once Twilio or another provider is configured via SystemConfig.
 */
import { prisma } from '../lib/db';

// ═══════════════════════════════════════════════════════════════════════════
// Types
// ═══════════════════════════════════════════════════════════════════════════

export interface NotificationMessage {
  title: string;
  body: string;
  metadata?: Record<string, any>;
}

export interface NotificationChannel {
  name: string;
  send(to: string, message: NotificationMessage, context?: any): Promise<boolean>;
  isEnabled(): Promise<boolean>;
}

export type NotificationEventType =
  | 'LIMIT_ORDER_MATCHED'
  | 'LIMIT_ORDER_BOOKED'
  | 'LIMIT_ORDER_EXPIRED'
  | 'LIMIT_ORDER_FAILED'
  | 'BOOKING_CONFIRMED'
  | 'PRICE_DROP_ALERT'
  | string;

// ═══════════════════════════════════════════════════════════════════════════
// In-App Channel — Always enabled
// ═══════════════════════════════════════════════════════════════════════════

class InAppChannel implements NotificationChannel {
  name = 'IN_APP';

  async send(userId: string, message: NotificationMessage): Promise<boolean> {
    try {
      await prisma.notification.create({
        data: {
          userId,
          type: 'LIMIT_ORDER' as any,
          channel: 'IN_APP' as any,
          title: message.title,
          body: message.body,
          metadata: message.metadata || {},
          status: 'SENT' as any,
          sentAt: new Date(),
        },
      });
      return true;
    } catch (err) {
      console.error('[notification-service] InApp channel failed:', err);
      return false;
    }
  }

  async isEnabled(): Promise<boolean> {
    return true; // Always enabled
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// SMS Channel — Disabled until configured
// ═══════════════════════════════════════════════════════════════════════════

interface SmsConfig {
  enabled: boolean;
  provider: 'twilio' | 'vonage' | 'aws_sns';
  accountSid?: string;
  authToken?: string;
  fromNumber?: string;
  allowedEvents?: string[];
  allowedCountries?: string[];
  requireConsent?: boolean;
}

class SmsChannel implements NotificationChannel {
  name = 'SMS';
  private configCache: SmsConfig | null = null;
  private configCachedAt: number = 0;
  private CONFIG_TTL_MS = 5 * 60 * 1000; // Cache config for 5 min

  async getConfig(): Promise<SmsConfig> {
    const now = Date.now();
    if (this.configCache && now - this.configCachedAt < this.CONFIG_TTL_MS) {
      return this.configCache;
    }

    try {
      const configRow = await prisma.systemConfig.findUnique({
        where: { key: 'sms_notification_config' },
      });

      if (configRow?.value) {
        this.configCache = JSON.parse(configRow.value) as SmsConfig;
      } else {
        this.configCache = { enabled: false, provider: 'twilio' };
      }
    } catch {
      this.configCache = { enabled: false, provider: 'twilio' };
    }

    this.configCachedAt = now;
    return this.configCache;
  }

  async send(phoneNumber: string, message: NotificationMessage, context?: { eventType?: string }): Promise<boolean> {
    const config = await this.getConfig();
    if (!config.enabled) return false;

    // Check if this event type is allowed for SMS
    if (config.allowedEvents && config.allowedEvents.length > 0 && context?.eventType) {
      if (!config.allowedEvents.includes(context.eventType)) {
        console.log(`[notification-service] SMS: event ${context.eventType} not in allowed events`);
        return false;
      }
    }

    // Currently no SMS provider integration — log and return
    console.log(`[notification-service] SMS: Would send to ${phoneNumber} via ${config.provider}: "${message.title}"`);
    console.log(`[notification-service] SMS: Provider not yet integrated. Message not sent.`);

    // TODO: When Twilio is configured:
    // const twilio = require('twilio')(config.accountSid, config.authToken);
    // await twilio.messages.create({ body: message.body, from: config.fromNumber, to: phoneNumber });

    return false;
  }

  async isEnabled(): Promise<boolean> {
    const config = await this.getConfig();
    return config.enabled;
  }
}

// ═══════════════════════════════════════════════════════════════════════════
// Notification Service — Orchestrator
// ═══════════════════════════════════════════════════════════════════════════

class NotificationService {
  private channels: Map<string, NotificationChannel> = new Map();

  constructor() {
    this.channels.set('IN_APP', new InAppChannel());
    this.channels.set('SMS', new SmsChannel());
    // Email is handled by the existing notify() function (Brevo/SendInBlue)
    // It's not registered here because it has its own dedicated flow
  }

  /**
   * Send a notification across all enabled channels.
   * Email is handled separately via the existing notify() flow.
   */
  async sendInApp(userId: string, message: NotificationMessage): Promise<void> {
    const inApp = this.channels.get('IN_APP');
    if (inApp) {
      await inApp.send(userId, message);
    }
  }

  /**
   * Send SMS (if enabled and configured).
   */
  async sendSms(
    phoneNumber: string,
    message: NotificationMessage,
    eventType?: string,
  ): Promise<boolean> {
    const sms = this.channels.get('SMS');
    if (!sms) return false;
    const enabled = await sms.isEnabled();
    if (!enabled) return false;
    return sms.send(phoneNumber, message, { eventType });
  }

  /**
   * Check if SMS is enabled.
   */
  async isSmsEnabled(): Promise<boolean> {
    const sms = this.channels.get('SMS');
    if (!sms) return false;
    return sms.isEnabled();
  }

  /**
   * Get the status of all notification channels.
   */
  async getChannelStatus(): Promise<Record<string, boolean>> {
    const status: Record<string, boolean> = {};
    for (const [name, channel] of this.channels) {
      status[name] = await channel.isEnabled();
    }
    // Email is always enabled
    status['EMAIL'] = true;
    return status;
  }
}

// Singleton
export const notificationService = new NotificationService();
