import { useState, useEffect } from 'react';

export const useOpenCV = () => {
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const checkOpenCV = () => {
      if (window.cvReady) {
        setReady(true);
        return true;
      }
      return false;
    };

    if (checkOpenCV()) return;

    const interval = setInterval(() => {
      if (checkOpenCV()) {
        clearInterval(interval);
      }
    }, 100);

    return () => clearInterval(interval);
  }, []);

  return ready;
};
