'use client'

import { useState, useEffect } from 'react'
import { useAuth } from '@/components/AuthProvider'
import { createClient } from '@/lib/supabase/client'
import { useToast } from '@/hooks/useToast'

export default function AccountSettings() {
  const { profile, refreshProfile } = useAuth()
  const supabase = createClient()
  const { toast } = useToast()

  // Profile state
  const [fullName, setFullName] = useState('')
  const [saving, setSaving] = useState(false)

  // Security state
  const [newPassword, setNewPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [changingPassword, setChangingPassword] = useState(false)
  const [passwordError, setPasswordError] = useState<string | null>(null)

  // Sync profile data when it loads
  useEffect(() => {
    if (profile) {
      setFullName(profile.full_name || '')
    }
  }, [profile])

  const handleSaveProfile = async () => {
    if (!profile) return
    setSaving(true)

    const { error } = await supabase
      .from('profiles')
      .update({ full_name: fullName.trim() })
      .eq('id', profile.id)

    if (error) {
      toast({ title: `Failed to update profile: ${error.message}`, type: 'error' })
    } else {
      toast({ title: 'Profile updated', type: 'success' })
      await refreshProfile()
    }
    setSaving(false)
  }

  const handleChangePassword = async () => {
    setPasswordError(null)

    if (newPassword.length < 8) {
      setPasswordError('Password must be at least 8 characters')
      return
    }
    if (newPassword !== confirmPassword) {
      setPasswordError('Passwords do not match')
      return
    }

    setChangingPassword(true)

    const { error } = await supabase.auth.updateUser({ password: newPassword })

    if (error) {
      toast({ title: `Failed to change password: ${error.message}`, type: 'error' })
    } else {
      toast({ title: 'Password changed successfully', type: 'success' })
      setNewPassword('')
      setConfirmPassword('')
    }
    setChangingPassword(false)
  }

  if (!profile) {
    return (
      <p className="py-8 text-center text-sm" style={{ color: 'var(--text-faint)' }}>
        Loading account...
      </p>
    )
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Profile Card */}
      <div
        className="rounded-lg p-5"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}
      >
        <h2 className="mb-4 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
          Profile
        </h2>

        <div className="flex flex-col gap-4">
          {/* Full Name */}
          <div>
            <label
              className="mb-1.5 block text-xs font-medium"
              style={{ color: 'var(--text-secondary)' }}
            >
              Full Name
            </label>
            <input
              type="text"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              className="w-full rounded-md px-3 py-2.5 text-sm outline-none"
              style={{
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-input)',
              }}
              placeholder="Your full name"
            />
          </div>

          {/* Email (read-only) */}
          <div>
            <label
              className="mb-1.5 block text-xs font-medium"
              style={{ color: 'var(--text-secondary)' }}
            >
              Email
            </label>
            <div
              className="rounded-md px-3 py-2.5 text-sm"
              style={{
                background: 'var(--bg-secondary)',
                color: 'var(--text-muted)',
                border: '1px solid var(--border-subtle)',
              }}
            >
              {profile.email}
            </div>
            <p className="mt-1 text-xs" style={{ color: 'var(--text-faint)' }}>
              Contact an admin to change your email address.
            </p>
          </div>

          {/* Role (read-only badge) */}
          <div>
            <label
              className="mb-1.5 block text-xs font-medium"
              style={{ color: 'var(--text-secondary)' }}
            >
              Role
            </label>
            <span
              className="inline-block rounded-full px-3 py-1 text-xs font-medium"
              style={{
                background: profile.role === 'admin'
                  ? 'rgba(76,114,176,0.2)'
                  : 'rgba(160,160,160,0.2)',
                color: profile.role === 'admin'
                  ? 'var(--accent)'
                  : 'var(--text-secondary)',
              }}
            >
              {profile.role === 'admin' ? 'Admin' : 'Member'}
            </span>
          </div>

          {/* Save button */}
          <div className="flex justify-end pt-2">
            <button
              onClick={handleSaveProfile}
              disabled={saving || fullName.trim() === profile.full_name}
              className="rounded-md px-5 py-2 text-sm font-medium transition-colors"
              style={{
                background: saving || fullName.trim() === profile.full_name
                  ? 'var(--hover-medium)'
                  : 'var(--accent)',
                color: '#ffffff',
                border: 'none',
                cursor: saving || fullName.trim() === profile.full_name
                  ? 'not-allowed'
                  : 'pointer',
                opacity: saving || fullName.trim() === profile.full_name ? 0.6 : 1,
              }}
            >
              {saving ? 'Saving...' : 'Save Profile'}
            </button>
          </div>
        </div>
      </div>

      {/* Security Card */}
      <div
        className="rounded-lg p-5"
        style={{ background: 'var(--bg-card)', border: '1px solid var(--border-subtle)' }}
      >
        <h2 className="mb-4 text-lg font-semibold" style={{ color: 'var(--text-primary)' }}>
          Security
        </h2>

        <div className="flex flex-col gap-4">
          {passwordError && (
            <div
              className="rounded-md p-3 text-sm"
              style={{ background: 'rgba(196,78,82,0.2)', color: 'var(--danger)' }}
            >
              {passwordError}
            </div>
          )}

          {/* New Password */}
          <div>
            <label
              className="mb-1.5 block text-xs font-medium"
              style={{ color: 'var(--text-secondary)' }}
            >
              New Password
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={(e) => {
                setNewPassword(e.target.value)
                setPasswordError(null)
              }}
              className="w-full rounded-md px-3 py-2.5 text-sm outline-none"
              style={{
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-input)',
              }}
              placeholder="Minimum 8 characters"
            />
          </div>

          {/* Confirm Password */}
          <div>
            <label
              className="mb-1.5 block text-xs font-medium"
              style={{ color: 'var(--text-secondary)' }}
            >
              Confirm Password
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={(e) => {
                setConfirmPassword(e.target.value)
                setPasswordError(null)
              }}
              className="w-full rounded-md px-3 py-2.5 text-sm outline-none"
              style={{
                background: 'var(--bg-primary)',
                color: 'var(--text-primary)',
                border: '1px solid var(--border-input)',
              }}
              placeholder="Re-enter your new password"
            />
          </div>

          {/* Change Password button */}
          <div className="flex justify-end pt-2">
            <button
              onClick={handleChangePassword}
              disabled={changingPassword || !newPassword || !confirmPassword}
              className="rounded-md px-5 py-2 text-sm font-medium transition-colors"
              style={{
                background: changingPassword || !newPassword || !confirmPassword
                  ? 'var(--hover-medium)'
                  : 'var(--accent)',
                color: '#ffffff',
                border: 'none',
                cursor: changingPassword || !newPassword || !confirmPassword
                  ? 'not-allowed'
                  : 'pointer',
                opacity: changingPassword || !newPassword || !confirmPassword ? 0.6 : 1,
              }}
            >
              {changingPassword ? 'Changing...' : 'Change Password'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
