'use client'

import AuthGuard from '@/components/AuthGuard'
import Header from '@/components/Header'
import ContactForm from '@/components/ContactForm'
import { useCategories } from '@/hooks/useCategories'

export default function NewContactClient() {
  const { categories } = useCategories()

  return (
    <AuthGuard>
      <div className="min-h-screen">
        <Header />

        <main className="mx-auto max-w-7xl px-4 py-6 sm:px-6">
          <div className="mb-6">
            <h1 className="text-xl font-bold" style={{ color: 'var(--text-primary)' }}>
              New Contact
            </h1>
            <p className="mt-1 text-sm" style={{ color: 'var(--text-secondary)' }}>
              Add a new contact to the CRM
            </p>
          </div>

          <div
            className="rounded-lg p-6"
            style={{
              background: 'var(--bg-card)',
              border: '1px solid var(--border-subtle)',
            }}
          >
            <ContactForm mode="create" categories={categories} />
          </div>
        </main>
      </div>
    </AuthGuard>
  )
}
