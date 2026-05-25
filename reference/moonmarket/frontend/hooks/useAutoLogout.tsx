import { useEffect } from 'react';
import useLogout from '@/hooks/useLogOut';

const useAutoLogout = (inactivityTimeout: number = 15 * 60 * 1000): null => {
  const handleLogout = useLogout();

  useEffect(() => {
    let timer: NodeJS.Timeout;

    const resetTimer = (): void => {
      clearTimeout(timer);
      timer = setTimeout(handleLogout, inactivityTimeout);
    };

    window.addEventListener('mousemove', resetTimer);
    window.addEventListener('keydown', resetTimer);
    window.addEventListener('scroll', resetTimer);

    resetTimer();

    return () => {
      window.removeEventListener('mousemove', resetTimer);
      window.removeEventListener('keydown', resetTimer);
      window.removeEventListener('scroll', resetTimer);
      clearTimeout(timer);
    };
  }, [handleLogout, inactivityTimeout]);

  return null;
};

export default useAutoLogout;