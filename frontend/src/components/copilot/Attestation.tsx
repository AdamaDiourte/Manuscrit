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
          {analysis ? " et les transmettre au prestataire IA pour analyse" : ""}
          .
        </span>
      </label>
      <small>
        Les données pseudonymisées restent des données personnelles. Conservez
        la table de correspondance hors de Manuscrit.
      </small>
    </div>
  );
}
