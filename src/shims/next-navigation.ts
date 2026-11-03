import { useMemo } from "react";
import { NotFoundSignal, useLocationState } from "./router";

export function useSearchParams(): URLSearchParams {
  const { search } = useLocationState();
  return useMemo(() => new URLSearchParams(search), [search]);
}

export function notFound(): never {
  throw new NotFoundSignal();
}
