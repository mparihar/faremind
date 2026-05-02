import { NextRequest, NextResponse } from 'next/server';
import {
  getUserNotifications,
  markNotificationRead,
  getUnreadCount,
} from '@/lib/db-queries';

/**
 * GET /api/notifications?userId=xxx
 */
export async function GET(request: NextRequest) {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get('userId');
  const limit = parseInt(searchParams.get('limit') || '50');

  if (!userId) {
    return NextResponse.json({ error: 'userId is required' }, { status: 400 });
  }

  try {
    const [notifications, unreadCount] = await Promise.all([
      getUserNotifications(userId, limit),
      getUnreadCount(userId),
    ]);

    return NextResponse.json({ notifications, unreadCount });
  } catch (error) {
    console.error('Failed to fetch notifications:', error);
    return NextResponse.json(
      { error: 'Failed to fetch notifications' },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/notifications
 * Mark a notification as read
 */
export async function PATCH(request: NextRequest) {
  try {
    const body = await request.json();
    const { notificationId } = body;

    if (!notificationId) {
      return NextResponse.json(
        { error: 'notificationId is required' },
        { status: 400 }
      );
    }

    const notification = await markNotificationRead(notificationId);
    return NextResponse.json({ notification });
  } catch (error) {
    console.error('Failed to update notification:', error);
    return NextResponse.json(
      { error: 'Failed to update notification' },
      { status: 500 }
    );
  }
}
