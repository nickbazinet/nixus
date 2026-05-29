import { createContext, useContext, useState, useCallback, useEffect, type ReactNode } from "react";

interface ValuesVisibilityState {
  hidden: boolean;
  toggleHidden: () => void;
}

const ValuesVisibilityContext = createContext<ValuesVisibilityState | null>(null);

const STORAGE_KEY = "values-hidden";

export function ValuesVisibilityProvider({ children }: { children: ReactNode }) {
  const [hidden, setHidden] = useState(() => {
    try {
      return localStorage.getItem(STORAGE_KEY) === "true";
    } catch {
      return false;
    }
  });

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, String(hidden));
    } catch {
      // localStorage unavailable
    }
  }, [hidden]);

  const toggleHidden = useCallback(() => setHidden((h) => !h), []);

  return (
    <ValuesVisibilityContext.Provider value={{ hidden, toggleHidden }}>
      {children}
    </ValuesVisibilityContext.Provider>
  );
}

export function useValuesHidden() {
  const ctx = useContext(ValuesVisibilityContext);
  if (!ctx) throw new Error("useValuesHidden must be used within ValuesVisibilityProvider");
  return ctx;
}
