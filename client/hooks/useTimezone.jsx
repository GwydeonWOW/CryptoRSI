import { createContext, useContext, useState, useEffect } from 'react';

const TimezoneContext = createContext('Europe/Madrid');

export function TimezoneProvider({ children }) {
  const [tz, setTz] = useState(() => localStorage.getItem('timezone') || 'Europe/Madrid');

  useEffect(() => {
    localStorage.setItem('timezone', tz);
  }, [tz]);

  return (
    <TimezoneContext.Provider value={{ timezone: tz, setTimezone: setTz }}>
      {children}
    </TimezoneContext.Provider>
  );
}

export function useTimezone() {
  return useContext(TimezoneContext);
}
