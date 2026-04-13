'use client';

import { use, useEffect, useState } from 'react';
import { useSearchParams } from 'next/navigation';

type PageState = 'idle' | 'loading' | 'success' | 'error';

export default function InviteAcceptPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const searchParams = useSearchParams();
  const [state, setState] = useState<PageState>('idle');
  const [errorMessage, setErrorMessage] = useState('');

  // Handle redirect back from OAuth
  useEffect(() => {
    if (searchParams.get('success') === 'true') {
      setState('success');
    }
    const error = searchParams.get('error');
    if (error) {
      setErrorMessage(decodeURIComponent(error));
      setState('error');
    }
  }, [searchParams]);

  const handleAccept = () => {
    setState('loading');
    window.location.href = `/api/auth/guest-login?token=${token}`;
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <div className="max-w-md w-full space-y-6 p-8">
        <div className="text-center">
          <h1 className="text-2xl font-bold text-gray-900">BoostCal</h1>
          <p className="mt-2 text-gray-600">カレンダー連携の招待</p>
        </div>

        {state === 'idle' && (
          <div className="space-y-4">
            <p className="text-sm text-gray-600 text-center">
              Googleアカウントでログインして、カレンダーへのアクセスを許可してください。
              これにより、空き時間の自動計算が可能になります。
            </p>
            <button
              onClick={handleAccept}
              className="w-full flex items-center justify-center gap-3 px-4 py-3 border border-gray-300 rounded-lg shadow-sm bg-white text-gray-700 hover:bg-gray-50 transition-colors"
            >
              <svg className="w-5 h-5" viewBox="0 0 24 24">
                <path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" />
                <path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" />
                <path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" />
                <path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" />
              </svg>
              Google でカレンダーを連携
            </button>
          </div>
        )}

        {state === 'loading' && (
          <p className="text-center text-gray-500">リダイレクト中...</p>
        )}

        {state === 'success' && (
          <div className="bg-green-50 border border-green-200 rounded-md p-4 text-center">
            <p className="text-green-800 font-medium">カレンダー連携が完了しました</p>
            <p className="mt-2 text-sm text-green-600">
              このページを閉じて問題ありません。
            </p>
          </div>
        )}

        {state === 'error' && (
          <div className="bg-red-50 border border-red-200 rounded-md p-4 text-center">
            <p className="text-red-700">{errorMessage}</p>
            <button
              onClick={() => setState('idle')}
              className="mt-3 text-sm text-blue-600 hover:text-blue-800"
            >
              もう一度試す
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
