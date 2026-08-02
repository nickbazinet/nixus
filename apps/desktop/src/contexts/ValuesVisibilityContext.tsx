import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  useMemo,
  type ReactNode,
} from "react";
import { useTranslation } from "react-i18next";

/** Spread straight onto `<Money>` / `<Stat>` / `<MaskedFigure>` from `@nixus/shared`. */
interface MaskProps {
  masked: boolean;
  maskedLabel: string;
}

interface ValuesVisibilityState {
  hidden: boolean;
  toggleHidden: () => void;
  maskProps: MaskProps;
}

const ValuesVisibilityContext = createContext<ValuesVisibilityState | null>(null);

const STORAGE_KEY = "values-hidden";

export function ValuesVisibilityProvider({ children }: { children: ReactNode }) {
  const { t } = useTranslation();
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

  // The label is resolved here rather than at each call site so a masked figure can never ship
  // with an untranslated accessible name — the mask exists for someone in a public space, and an
  // English "Amount hidden" read by a French voice defeats it.
  const maskedLabel = t("common.amountHidden");

  const value = useMemo(
    () => ({
      hidden,
      toggleHidden,
      maskProps: { masked: hidden, maskedLabel },
    }),
    [hidden, toggleHidden, maskedLabel]
  );

  return (
    <ValuesVisibilityContext.Provider value={value}>
      {children}
    </ValuesVisibilityContext.Provider>
  );
}

export function useValuesHidden() {
  const ctx = useContext(ValuesVisibilityContext);
  if (!ctx) throw new Error("useValuesHidden must be used within ValuesVisibilityProvider");
  return ctx;
}

/** `<Money cents={x} {...useMaskProps()} />` — every figure in the product routes through this. */
export function useMaskProps(): MaskProps {
  return useValuesHidden().maskProps;
}

export type { MaskProps };
