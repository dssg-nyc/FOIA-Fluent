"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useParams } from "next/navigation";
import PatternDetailContent from "@/components/PatternDetailContent";
import {
  fetchPatternDetail,
  type PatternDetail,
} from "@/lib/signals-api";

function PatternDetailInner() {
  const params = useParams();
  const id = (params.id as string) || "";

  const [data, setData] = useState<PatternDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    fetchPatternDetail(id)
      .then(setData)
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id]);

  if (loading) {
    return (
      <main className="signals-container">
        <p className="signals-empty">Loading pattern…</p>
      </main>
    );
  }

  if (error || !data || !data.pattern) {
    return (
      <main className="signals-container">
        <Link href="/signals/patterns" className="signals-back-link">
          ← Back to patterns
        </Link>
        <p className="signals-empty">{error || "Pattern not found."}</p>
      </main>
    );
  }

  return (
    <main className="signals-container">
      <Link href="/signals/patterns" className="signals-back-link">
        ← Back to all patterns
      </Link>
      <PatternDetailContent pattern={data.pattern} signals={data.signals} variant="page" />
    </main>
  );
}

export default function PatternDetailPage() {
  return <PatternDetailInner />;
}
