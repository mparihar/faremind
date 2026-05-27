'use client';

import { useState, useEffect, useRef } from 'react';
import { useAuthStore } from '@/store/useAuthStore';
import { Check, User, Mail, Phone, Shield, KeyRound, Camera, Trash2, Upload } from 'lucide-react';

export default function ProfilePage() {
  const { user, updateAvatar, updateUser } = useAuthStore();
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [uploadingAvatar, setUploadingAvatar] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (user?.name) {
      const parts = user.name.split(' ');
      setFirstName(parts[0] || '');
      setLastName(parts.slice(1).join(' ') || '');
    }
  }, [user]);

  async function handleAvatarUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file || !user) return;

    // Validate file type
    if (!file.type.startsWith('image/')) {
      alert('Please select an image file (JPG, PNG, WebP, etc.)');
      return;
    }

    // Validate file size (max 2MB)
    if (file.size > 2 * 1024 * 1024) {
      alert('Image must be smaller than 2MB');
      return;
    }

    setUploadingAvatar(true);

    try {
      // Resize and convert to base64
      const dataUrl = await resizeImage(file, 256);

      // Save to DB via API
      const res = await fetch('/api/auth/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, avatar: dataUrl }),
      });

      if (res.ok) {
        updateAvatar(dataUrl);
      }
    } catch (err) {
      console.error('Avatar upload failed:', err);
    } finally {
      setUploadingAvatar(false);
      // Reset file input so same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function handleRemoveAvatar() {
    if (!user) return;
    setUploadingAvatar(true);
    try {
      const res = await fetch('/api/auth/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ userId: user.id, avatar: null }),
      });
      if (res.ok) {
        updateAvatar(null);
      }
    } catch (err) {
      console.error('Failed to remove avatar:', err);
    } finally {
      setUploadingAvatar(false);
    }
  }

  async function handleSave() {
    if (!user) return;
    setSaving(true);
    try {
      const res = await fetch('/api/auth/profile', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          userId: user.id,
          firstName,
          lastName,
          phone,
        }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        updateUser({ name: data.user.name });
      }
    } catch (err) {
      console.error('Save failed:', err);
    }
    setSaving(false);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  }

  const iCls = 'w-full px-3 py-2.5 bg-white/[0.04] border border-white/[0.08] rounded-xl text-white text-sm focus:outline-none focus:border-[#1ABC9C] transition-all placeholder:text-slate-500';

  const initial = user?.name?.charAt(0).toUpperCase() || '?';

  return (
    <div>
      <h1 className="text-2xl font-black text-white mb-6">Profile</h1>

      <div className="grid gap-4 max-w-xl">
        {/* Profile Photo */}
        <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Camera size={16} className="text-[#1ABC9C]" />
            <p className="text-sm font-bold text-white">Profile Photo</p>
          </div>

          <div className="flex items-center gap-5">
            {/* Avatar preview */}
            <div className="relative group">
              <div className="w-20 h-20 rounded-full overflow-hidden border-2 border-[#1ABC9C]/30 shadow-[0_0_20px_rgba(26,188,156,0.15)] flex-shrink-0">
                {user?.avatar ? (
                  <img
                    src={user.avatar}
                    alt="Profile photo"
                    className="w-full h-full object-cover"
                  />
                ) : (
                  <div className="w-full h-full bg-[#1ABC9C]/15 flex items-center justify-center">
                    <span className="text-2xl font-black text-[#1ABC9C]">{initial}</span>
                  </div>
                )}
              </div>
              {/* Hover overlay on avatar */}
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingAvatar}
                className="absolute inset-0 rounded-full bg-black/50 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity cursor-pointer"
              >
                {uploadingAvatar ? (
                  <span className="w-5 h-5 border-2 border-white border-t-transparent rounded-full animate-spin" />
                ) : (
                  <Camera size={20} className="text-white" />
                )}
              </button>
            </div>

            {/* Upload / Remove buttons */}
            <div className="flex flex-col gap-2">
              <button
                onClick={() => fileInputRef.current?.click()}
                disabled={uploadingAvatar}
                className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold text-white bg-[#1ABC9C]/15 border border-[#1ABC9C]/25 hover:bg-[#1ABC9C]/25 transition-all disabled:opacity-50"
              >
                <Upload size={14} />
                {uploadingAvatar ? 'Uploading…' : 'Upload Photo'}
              </button>
              {user?.avatar && (
                <button
                  onClick={handleRemoveAvatar}
                  disabled={uploadingAvatar}
                  className="flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-medium text-red-400/80 hover:text-red-400 hover:bg-red-500/[0.06] transition-all disabled:opacity-50"
                >
                  <Trash2 size={14} />
                  Remove
                </button>
              )}
              <p className="text-[10px] text-slate-500 mt-0.5">JPG, PNG or WebP. Max 2MB.</p>
            </div>

            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/jpeg,image/png,image/webp,image/gif"
              onChange={handleAvatarUpload}
              className="hidden"
            />
          </div>
        </div>

        {/* Personal Info */}
        <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <User size={16} className="text-[#1ABC9C]" />
            <p className="text-sm font-bold text-white">Personal Information</p>
          </div>
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs text-slate-400 uppercase font-bold mb-1 block">First Name</label>
                <input value={firstName} onChange={e => setFirstName(e.target.value)} className={iCls} placeholder="First name" />
              </div>
              <div>
                <label className="text-xs text-slate-400 uppercase font-bold mb-1 block">Last Name</label>
                <input value={lastName} onChange={e => setLastName(e.target.value)} className={iCls} placeholder="Last name" />
              </div>
            </div>
            <div>
              <label className="text-xs text-slate-400 uppercase font-bold mb-1 block">Phone</label>
              <input value={phone} onChange={e => setPhone(e.target.value)} className={iCls} placeholder="+1 (555) 000-0000" />
            </div>
          </div>
        </div>

        {/* Account */}
        <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Mail size={16} className="text-[#1ABC9C]" />
            <p className="text-sm font-bold text-white">Account</p>
          </div>
          <div className="space-y-3">
            <div>
              <label className="text-xs text-slate-400 uppercase font-bold mb-1 block">Email Address</label>
              <input disabled value={user?.email || ''} className={`${iCls} opacity-50 cursor-not-allowed`} />
              <p className="text-[10px] text-slate-400 mt-1">Email cannot be changed. Contact support if needed.</p>
            </div>
          </div>
        </div>

        {/* Security */}
        <div className="bg-white/[0.04] border border-white/[0.08] rounded-2xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <Shield size={16} className="text-[#1ABC9C]" />
            <p className="text-sm font-bold text-white">Security</p>
          </div>
          <div className="flex items-center justify-between">
            <div>
              <p className="text-white text-sm font-medium">OTP Authentication</p>
              <p className="text-slate-400 text-xs mt-0.5">Sign in with a one-time code sent to your email</p>
            </div>
            <span className="px-2.5 py-1 rounded-full text-[11px] font-bold bg-[#1ABC9C]/10 text-[#1ABC9C] border border-[#1ABC9C]/20">
              Active
            </span>
          </div>
        </div>

        {/* Save */}
        <button onClick={handleSave} disabled={saving}
          className="flex items-center justify-center gap-2 py-3 rounded-xl bg-[#1ABC9C] text-white font-bold text-sm disabled:opacity-60 transition-all hover:bg-[#16a085]">
          {saving
            ? <><span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" /> Saving…</>
            : saved
              ? <><Check size={16} /> Saved</>
              : 'Save Changes'}
        </button>
      </div>
    </div>
  );
}

/**
 * Resize an image file to a max dimension and return as a base64 data URL.
 * This keeps the stored avatar small enough for DB storage.
 */
function resizeImage(file: File, maxSize: number): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const canvas = document.createElement('canvas');
        let w = img.width;
        let h = img.height;

        // Scale down if larger than maxSize
        if (w > h) {
          if (w > maxSize) { h = Math.round(h * maxSize / w); w = maxSize; }
        } else {
          if (h > maxSize) { w = Math.round(w * maxSize / h); h = maxSize; }
        }

        canvas.width = w;
        canvas.height = h;
        const ctx = canvas.getContext('2d');
        if (!ctx) return reject(new Error('Canvas context failed'));

        ctx.drawImage(img, 0, 0, w, h);
        resolve(canvas.toDataURL('image/webp', 0.85));
      };
      img.onerror = reject;
      img.src = reader.result as string;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}
