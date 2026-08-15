import api from './axios'
import type { ApiResponse } from '@/types'

// ── In-app notifications (topbar bell) ──────────────────────────────────────
// Mirrors NotificationsController's in-app notification endpoints exactly:
// GET /api/notifications (role/user-targeted visibility is enforced
// server-side — the caller just gets back what it's allowed to see) and
// PUT /api/notifications/{id}/read. Creation is triggered internally by app
// events elsewhere in the backend/legacy frontend (loan created/approved/
// rejected/disbursed, payout claim submitted, etc.) — reproducing every one
// of those trigger points is outside this feature's scope, so only the
// read/mark-read surface is implemented here.
export interface AppNotification {
  id: number
  type: string
  icon?: string | null
  message?: string | null
  claimId?: string | null
  partner?: string | null
  amount?: number | null
  targetUserId?: number | null
  isRead: boolean
  createdAt: string
}

export const notificationsApi = {
  getAll: (unreadOnly = false) =>
    api.get<ApiResponse<AppNotification[]>>('/api/notifications', { params: unreadOnly ? { unreadOnly: true } : undefined }),

  markRead: (id: number) =>
    api.put<ApiResponse<boolean>>(`/api/notifications/${id}/read`),
}
