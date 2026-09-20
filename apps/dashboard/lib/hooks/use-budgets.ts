"use client";

import { useCallback, useEffect, useState } from "react";
import {
  createBudget,
  deleteBudget,
  getBudgets,
  updateBudget,
  type Budget,
} from "@/lib/api-ext";

/** Budgets: hierarchy with utilization/forecast + CRUD. Zero-state safe. */
export function useBudgets(history = false) {
  const [budgets, setBudgets] = useState<Budget[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await getBudgets(history);
      setBudgets(res.budgets);
    } catch (e) {
      setError(e instanceof Error ? e.message : "unavailable");
    } finally {
      setLoading(false);
    }
  }, [history]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const create = useCallback(
    async (input: { level: string; key: string; window: string; tokenLimit: number; dollarLimit: number }) => {
      const res = await createBudget(input);
      await refresh();
      return res.budget;
    },
    [refresh]
  );

  const update = useCallback(
    async (id: string, patch: { tokenLimit?: number; dollarLimit?: number; window?: string }) => {
      const res = await updateBudget(id, patch);
      await refresh();
      return res.budget;
    },
    [refresh]
  );

  const remove = useCallback(
    async (id: string) => {
      await deleteBudget(id);
      await refresh();
    },
    [refresh]
  );

  return { budgets, loading, error, refresh, create, update, remove };
}
