"use client";
import { useState } from "react";
import { Crown } from "lucide-react";
import { Button, Card, cn } from "@/components/ui";
import { PageHeader } from "@/components/admin";
import { useToast } from "@/components/ui/Toast";
import { useFinals } from "@/components/finals/common";
import FinalistsTab from "@/components/finals/FinalistsTab";
import JudgesTab from "@/components/finals/JudgesTab";
import RoundsTab from "@/components/finals/RoundsTab";
import ResultsTab from "@/components/finals/ResultsTab";
import { initFinalConfig } from "@/lib/finalsActions";
import { errorMessage } from "@/lib/firebase";

const TABS = [
  ["finalists", "1 · Finalists"],
  ["judges", "2 · Judges"],
  ["rounds", "3 · Rounds"],
  ["results", "4 · Results"],
] as const;
type Tab = (typeof TABS)[number][0];

export default function FinalsPage() {
  const { finalConfig, admin } = useFinals();
  const toast = useToast();
  const [tab, setTab] = useState<Tab>("finalists");
  const [busy, setBusy] = useState(false);

  if (!finalConfig) {
    return (
      <div>
        <PageHeader title="Finals" subtitle="Final 20 → Fashion Walk → Talent Round → Question & Answer → Winners" />
        <Card className="mx-auto max-w-xl p-8 text-center">
          <div className="mx-auto flex size-14 items-center justify-center rounded-2xl bg-amber-50 text-amber-600">
            <Crown className="size-7" />
          </div>
          <h2 className="mt-4 text-xl font-bold">Set up the Finals</h2>
          <p className="mt-2 text-sm text-slate-600">
            Creates the three final rounds — Fashion Walk, Talent Round and Question &amp; Answer — with their judging criteria (each /10). Judges score on their phones through personal links, and the top 3 boys and top 3 girls advance in each round. You can edit everything afterwards.
          </p>
          <Button
            size="lg"
            className="mt-6 w-full"
            loading={busy}
            onClick={async () => {
              setBusy(true);
              try {
                await initFinalConfig(admin);
              } catch (e) {
                toast(errorMessage(e), "error");
              } finally {
                setBusy(false);
              }
            }}
          >
            Set up Finals
          </Button>
        </Card>
      </div>
    );
  }

  return (
    <div>
      <PageHeader title="Finals" subtitle="Final 20 → Fashion Walk → Talent Round → Question & Answer → Winners (boys and girls)" />
      <div className="no-print mb-4 inline-flex flex-wrap gap-1 rounded-xl bg-slate-100 p-1">
        {TABS.map(([k, l]) => (
          <button key={k} onClick={() => setTab(k)} className={cn("rounded-lg px-4 py-1.5 text-sm font-semibold", tab === k ? "bg-white shadow-sm" : "text-slate-600")}>
            {l}
          </button>
        ))}
      </div>
      {tab === "finalists" && <FinalistsTab />}
      {tab === "judges" && <JudgesTab />}
      {tab === "rounds" && <RoundsTab />}
      {tab === "results" && <ResultsTab />}
    </div>
  );
}
