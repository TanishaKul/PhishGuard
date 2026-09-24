'use client';

import React, { useEffect } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { Sidebar } from './Sidebar';
import { Header } from './Header';
import { ApiErrorPanel, LoadingPanel } from '@/components/ui/ApiErrorPanel';
import { refreshSession, useSession } from '@/lib/hooks';

export function AppShell({ children }: { children: React.ReactNode }) {
  const session = useSession();
  const router = useRouter();
  const pathname = usePathname();

  useEffect(() => {
    if (session.status === 'signed-out') {
      router.replace(`/login?next=${encodeURIComponent(pathname)}`);
    }
  }, [session.status, router, pathname]);

  if (session.status !== 'signed-in') {
    return (
      <div className="min-h-screen flex items-center justify-center bg-app text-slate-100 cyber-grid-bg p-6">
        <div className="w-full max-w-lg">
          {session.status === 'error' ? (
            <ApiErrorPanel error={session.error} onRetry={refreshSession} />
          ) : (
            <LoadingPanel label="Checking your session..." />
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex bg-app text-slate-100 cyber-grid-bg">
      <Sidebar />
      <div className="flex-1 flex flex-col min-w-0">
        <Header />
        <main className="flex-1 p-6 overflow-y-auto max-w-7xl w-full mx-auto space-y-6">
          {children}
        </main>
      </div>
    </div>
  );
}
