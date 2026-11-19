export default function Attestation({
  checked,
  onChange,
  analysis = false,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  analysis?: boolean;
}) {
  return (
    <div className="attestation">
      <label>
        <input
          type="checkbox"
          checked={checked}
          required
          onChange={(e) => onChange(e.target.checked)}
        />
        <span>
          Je confirme que ces contenus sont anonymes ou pseudonymisés et que je
          dispose des droits et autorisations nécessaires pour les déposer
          {analysis
            ? " et les transmettre au prestataire IA uniquement pour obtenir un plan de rédaction fondé sur mes matériaux"
            : ""}
          .
        </span>
      </label>
      <small>
        Les données pseudonymisées restent des données personnelles. Conservez
        la table de correspondance hors de Manuscrit.
        {analysis
          ? " Au-delà de cette analyse, Manuscrit ne vend pas vos matériaux et ne les partage pas à des tiers à d’autres fins."
          : " Ces dépôts ne sont ni vendus ni partagés à des tiers hors du fonctionnement du service."}
      </small>
    </div>
  );
}
