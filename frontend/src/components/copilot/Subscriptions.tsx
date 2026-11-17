
import { useEffect, useState } from "react";
export default function Subscriptions() {
  const [account, set] = useState<any>(),
    [err, error] = useState(""),
    [pending, busy] = useState(false);
  useEffect(() => {
    fetch("/api/billing")
      .then(async (r) => {
        if (!r.ok) throw Error();
        set((await r.json()) as any);
      })
      .catch(() => error("Le suivi de l’abonnement est indisponible."));
  }, []);
  async function checkout(plan: string) {
    busy(true);
    error("");
    try {
      const r = await fetch("/api/billing", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = (await r.json()) as any;
      if (!r.ok || !data.url)
        throw Error(data.error || "Paiement indisponible.");
      window.location.assign(data.url);
    } catch (e: any) {
      error(e.message);
      busy(false);
    }
  }
  return (
    <section className="cp-section">
      <h2>Votre abonnement</h2>
      <p>
        {account
          ? account.used +
            " / " +
            account.limit +
            " analyses utilisées ce mois-ci."
          : "Chargement des droits…"}
      </p>
      <div className="plan-grid">
        {[
          ["free", "Découverte", 1],
          ["plus", "Recherche", 20],
          ["pro", "Laboratoire", 60],
        ].map(([id, title, count]) => (
          <article className="cp-card" key={id}>
            <h3>{title}</h3>
            <p>
              {count} analyse{count === 1 ? "" : "s"} par mois
            </p>
            <strong>
              {id === "free"
                ? "Gratuit"
                : account?.prices?.[id] || "Tarif en attente de configuration"}
            </strong>
            {id === account?.plan ? (
              <p className="badge-cp">Formule actuelle</p>
            ) : (
              id !== "free" && (
                <button
                  className="secondary"
                  disabled={pending || !account?.configured}
                  onClick={() =>
                    checkout(account?.plan !== "free" ? "portal" : String(id))
                  }
                >
                  Choisir cette formule
                </button>
              )
            )}
          </article>
        ))}
      </div>
      {account?.customer && (
        <button className="secondary" onClick={() => checkout("portal")}>
          Gérer la facturation sur Stripe
        </button>
      )}
      {err && <p role="alert">{err}</p>}
    </section>
  );
}
