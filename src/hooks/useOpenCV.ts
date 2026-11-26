import { useState, useEffect, useCallback } from 'react';

const LOAD_TIMEOUT_MS = 25000;

export const useOpenCV = () => {
  const [ready, setReady] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setReady(false);
    setError(null);
    if (typeof window.loadOpenCvScript === 'function') {
      window.loadOpenCvScript();
    }
    setAttempt((prev) => prev + 1);
  }, []);

  useEffect(() => {
    const checkOpenCV = () => {
      if (window.cvReady && window.cv && typeof window.cv.Mat === 'function') {
        setReady(true);
        setError(null);
        return true;
      }
      if (window.cvLoadStatus === 'error') {
        setError(window.cvLoadError || '影像辨識模組載入失敗，請檢查網路連線後重試。');
        return true;
      }
      return false;
    };

    if (checkOpenCV()) return;

    const startTime = Date.now();
    const interval = setInterval(() => {
      if (checkOpenCV()) {
        clearInterval(interval);
        return;
      }
      if (Date.now() - startTime >= LOAD_TIMEOUT_MS) {
        clearInterval(interval);
        setError('影像辨識模組載入逾時，可能因網路較慢或外部 CDN 受限，請點擊重試。');
      }
    }, 100);

    return () => clearInterval(interval);
  }, [attempt]);

  return { ready, error, retry };
};
